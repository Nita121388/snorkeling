# VCS 路径编码契约（后端）

> 适用范围：`pkg/wshrpc/wshremote/vcs.go`（版本管理 Block 的 git / svn 后端）。
> 来源：2026-10-22 `vcs-chinese-path-encoding` 任务（中文文件名在 Changes 列表里变成
> `\346\226\260...`，且 Diff / History / Commit 全部失败）。

## 为什么有这个契约

整条链路（git → Go → JSON → TS）本来就是 UTF-8，**任何一层都不需要编解码转换**。
真正的问题在 git 的**输出格式**：git 默认 `core.quotePath=true`，把非 ASCII 路径按
C 风格输出成八进制转义并加双引号。

实测（git 2.45.1）：

```
$ git status --porcelain=1 -uall
?? "\346\226\260\345\273\272\346\226\207\344\273\266.txt"      # 实为 新建文件.txt

$ git diff HEAD -- '\346\226\260\345\273\272\346\226\207\344\273\266.txt'
fatal: Invalid path '/346': No such file or directory
```

历史实现只做 `strings.Trim(path, "\"")`（去引号、不反转义），于是转义串一路透传到前端，
又被当作 pathspec 送回 git，导致**显示错 + 操作全失败**。

## 必须遵守的不变量

### 1. 所有 git 子命令必须关闭路径转义

- `newVcsCommand` 是 git / svn 子命令的**唯一**构造入口；`command == "git"` 时统一前置
  `-c core.quotePath=false`。
- `-c` 是 git 全局选项，必须排在子命令之前，所以只能在构造入口加，不能在调用点加。
- 新增 git 子命令时**不要**自己在调用点拼 `-c`（会漏），也不要改用
  `GIT_CONFIG_COUNT` 环境变量方案（要求 git ≥ 2.31，`-c` 只要 ≥ 1.7.2）。

### 2. 解析端必须能反转义 C 风格引号

- `decodeGitPathToken(token string) string`：处理 `"` 包裹的 token，
  按 git `quote.c` 还原 `\a \b \f \n \r \t \v \\ \"` 与 1~3 位八进制 `\NNN`（按字节还原）；
  非引号 token 原样返回。
- `splitGitRenamePath(raw string) (string, bool)`：只在**引号之外**找 ` -> `
  （重命名格式 `R  "old" -> "new"`），避免路径本身含 ` -> ` 时误切。
- 兜底的必要性：含空格 / 引号 / 制表符的路径**即使** `quotePath=false` 仍会被 git 加引号；
  用户也可能在全局配置里重新打开 `core.quotePath`。

### 3. 前端不做编解码

`VcsFileStatus.path` / `VcsCommitFileInfo.Path` 的语义是**真实路径**（仓库相对、正斜杠）。
前端原样渲染、原样当 pathspec 回传即可，不要在前端再解一次转义。

### 4. SVN 不走这条路

SVN 走 `--xml` 输出，XML 声明 UTF-8，路径本就是原始文本；`parseSvnStatusXML` 等函数
不需要（也不应该）加反转义逻辑。

### 5. porcelain 输出不得整体 trim

`git status --porcelain=1` 每行开头是两列状态码，**未暂存的修改行以空格开头**
（` M path`）。如果对整段输出做 `strings.TrimSpace`，第一行的行首空格被吃掉，
这一行会被误读成 `M path`：路径左移一个字符（`first.txt` → `irst.txt`），
`Staged` 判定也翻转。

- 取 porcelain 输出必须用 `runVcsCommandRaw`（`trimOutput=false`），
  逐行解析；行尾 `\r` 用 `strings.TrimRight(rawLine, "\r")` 处理。
- 不要试图让解析器「容忍缺列」：缺列的 `M path` 与合法的已暂存行 `M  path`
  在字符层面无法区分，只能在源头保留空格。

## 新增 / 修改 git 解析代码时的检查清单

1. 这个 git 命令的输出里含路径吗？含 → 必须经过 `decodeGitPathToken`。
2. 输出是 NUL 分隔或 tab 分隔多字段？tab 分隔时注意**取最后一个字段**才是重命名后的新路径。
3. 路径会被回传成 pathspec 吗？会 → 必须是解码后的真实路径，否则 git 报
   `Invalid path` / `pathspec did not match`。
4. 这个命令的输出是 porcelain（每行带两列状态码）吗？是 → **不能整体 trim**。
5. 改完跑 `go test ./pkg/wshrpc/wshremote`——里面有中文路径的单元测试与真实仓库集成测试
   （`TestDecodeGitPathToken*`、`TestParseGitStatusDecodesQuotedUnicodePath`、
   `TestParseGitCommitFilesDecodesQuotedUnicodePath`、
   `TestLoadGitRepoStateKeepsFirstStatusLinePath`、
   `TestRemoteVcsRepositoriesCommandDecodesUnicodePaths`）。

## 不在契约范围内

- `core.autocrlf` / `core.working-tree-encoding` 导致的仓库内编码转换。
- GBK 编码的老仓库。
- 含换行符的文件名（git 用 NUL 分隔才能正确表达，本项目未采用 `-z` 方案）。
