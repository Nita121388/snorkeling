# PRD — 修复 VCS Block 中文路径乱码（Git quotePath 转义未解码）

## 背景

Snorkeling 的版本管理 Block（VCS Block）在仓库路径或文件名含中文时，Changes 列表里
文件名显示为一串八进制转义，且对这些文件的 Diff / History / Commit 全部失败。

### 现状链路（证据）

| 环节 | 位置 | 行为 |
|---|---|---|
| git 默认配置 | 用户仓库 | `core.quotePath=true`，非 ASCII 路径按 C 风格输出为 `"octal\ escapes"` |
| 取状态 | `pkg/wshrpc/wshremote/vcs.go:660` `loadGitRepoState` | `git status --porcelain=1 -uall` |
| 解析状态 | `pkg/wshrpc/wshremote/vcs.go:609` `parseGitStatus` | `strings.Trim(path, "\"")` 只去引号，**不做反转义** |
| 取提交文件表 | `pkg/wshrpc/wshremote/vcs.go:1383` `loadGitCommitFiles` | `git show --name-status --pretty=format:` |
| 解析提交文件表 | `pkg/wshrpc/wshremote/vcs.go:1355` `parseGitCommitFiles` | 直接取最后一个字段，**引号与转义都没处理** |
| 前端渲染 | `frontend/app/view/vcs/vcs-changes-tab.tsx:328,350` | `status.path` 原样渲染，并作为 pathspec 回传后端 |

复现（真实 git 2.45.1）：

```
$ git status --porcelain=1 -uall
?? "\346\226\260\345\273\272\346\226\207\344\273\266.txt"     # 实为 新建文件.txt

$ git diff HEAD -- '\346\226\260\345\273\272\346\226\207\344\273\266.txt'
fatal: Invalid path '/346': No such file or directory
```

### 不受影响的部分（已核对）

仓库根路径、分支名、commit subject / author、diff 正文、SVN 的 `--xml` 路径、
Files Block 的目录列表（走 `os.ReadDir`）都是原始 UTF-8，链路正常。

## Goal

VCS Block 中非 ASCII（中文）文件名：

1. 在 Changes 列表、提交详情文件列表里显示为原始中文，而不是转义串；
2. 能正常打开 Diff / History，能被选中并 Commit；
3. 英文路径与现有行为完全不变。

## Requirements

### R1 — 命令侧关闭 git 路径转义

所有 git 子命令以 `-c core.quotePath=false` 运行，非 ASCII 路径直接输出原始 UTF-8。
改动收敛在 git 命令构造入口一处，svn 命令不受影响。

### R2 — 解析端反转义兜底

git 对含空格、引号、制表符的路径仍会加 C 风格引号；用户也可能在全局配置里重新打开
`core.quotePath`。因此解析端必须能还原 git 的 C 风格引号：

| 输出形态 | 期望解析结果 |
|---|---|
| `?? "\346\226\260...txt"` | `新建文件.txt` |
| `R  "\346\226\207...txt" -> "\351\207\215..."` | 取重命名后的新路径（已解码） |
| ` M "my file.txt"` | `my file.txt` |
| `A\t"\345\255\220...md"` | `子目录/测试文件.md` |

转义规则按 git `quote.c`：引号内 `\a \b \f \n \r \t \v \\ \"` 按 C 语义还原，
`\NNN`（1~3 位八进制）还原为对应字节；非引号包裹的路径原样保留。

### R3 — SVN 路径解析不变

SVN 走 XML 且声明 UTF-8，路径本就是原始文本，本次不改 `parseSvnStatusXML` 等函数。

### R4 — git status 输出不得整体 trim

（实施过程中发现的**既有缺陷**，与本问题同源，必须一并修掉。）

`git status --porcelain=1` 每行开头是两列状态码，未暂存的修改行以空格开头
（` M path`）。而 `loadGitRepoState` 走 `runVcsCommand`（`trimOutput=true`），
会对**整段输出**做 `strings.TrimSpace` —— 第一行的行首空格被吃掉，
于是该行被误读成 `M path`：

- 路径整体左移一个字符（`first.txt` 变成 `irst.txt`）；
- `Staged` 判定翻转（未暂存被当成已暂存）。

该缺陷在修复前对 **ASCII 路径同样存在**（只是当时路径被 git 转义成引号包裹，
掩盖了路径左移问题）。因此 `git status` 必须改用不 trim 的 `runVcsCommandRaw`。

### R5 — 回归测试

- 单元测试：解析端反转义（转义串、含空格路径、重命名路径、提交文件表）。
- 集成测试：真实 git 仓库 + 中文文件名，经 `RemoteVcsRepositoriesCommand` 取状态，
  断言路径是中文；经 `RemoteVcsFileDiffCommand` 取差异，断言返回内容而不是错误。

## Acceptance Criteria

1. `go test ./pkg/wshrpc/wshremote` 全绿，含新增测试。
2. 集成测试断言：中文文件在状态结果里的路径等于 `新建文件.txt`，
   且不含 `\346` 之类的转义片段。
3. 集成测试断言：对中文文件的 Diff 请求成功返回差异内容。
4. 现有 `pkg/wshrpc/wshremote` 全部既有测试保持通过（英文路径行为零变化）。
5. 前端不做改动；`frontend/` 无 diff。
6. 回归测试覆盖 R4：`git status` 第一行为未暂存修改时，路径不得左移字符，
   `Staged` 必须为 false。

## 非目标（Out of Scope）

- 不改 `core.autocrlf` / `core.working-tree-encoding` 导致的仓库内编码转换问题。
- 不处理 GBK 编码的老仓库。
- 不改 SVN 的路径处理。
- 不引入 `--porcelain=1 -z`（NUL 分隔）方案 —— 见 design.md 的取舍。
