# Design — VCS Block 中文路径乱码修复

## 问题定性

不是「前端编码」「JSON 编码」「Windows 代码页」问题，而是 **git 输出格式与后端解析器不匹配**：

- git 在 `core.quotePath=true`（默认）下，把非 ASCII 路径输出成 C 风格八进制转义并加双引号；
- 后端解析器假设路径是「引号包裹的普通文本」，只剥引号，不解转义；
- 转义串被原样送到前端，又被当作 pathspec 送回 git，于是匹配失败。

git → Go → JSON → TS 全链路都是 UTF-8，**不需要任何编解码转换**。

## 方案总览

两处改动，互补而非二选一：

| 层 | 改动 | 作用 |
|---|---|---|
| 命令层（R1） | git 调用统一加 `-c core.quotePath=false` | 让 git 直接吐原始 UTF-8，治本 |
| 解析层（R2） | 新增 C 风格引号反转义 | 兜住仍会被引号包裹的路径（空格 / 引号 / 制表符 / 用户强制开启 quotePath） |

## 命令层：改动点

`pkg/wshrpc/wshremote/vcs.go` 的 `newVcsCommand` 是所有 git / svn 子命令的唯一构造入口。
在其中对 `command == "git"` 的情况前置 `-c core.quotePath=false`：

```go
if command == "git" {
    args = append([]string{"-c", "core.quotePath=false"}, args...)
}
```

理由：

- `-c` 是 git 全局选项，必须放在子命令之前，`newVcsCommand` 是唯一能保证这一点的位置；
- 一次改动覆盖 `status` / `show --name-status` / `diff` / `log` / `branch` 等全部子命令，
  不必逐个调用点加参数（逐个加容易漏，例如 `RemoteVcsStatCommand` 里的第二处 `git status`）；
- `-c` 自 git 1.7.2 起可用，不引入新版本要求；相比 `GIT_CONFIG_COUNT` 环境变量方案（需 git ≥ 2.31）更宽松。

影响面（GitNexus impact）：`newVcsCommand` 风险 MEDIUM，31 个受影响符号全部落在
`pkg/wshrpc/wshremote` 模块内，即所有 VCS 命令路径；`parseGitStatus` / `parseGitCommitFiles`
风险 LOW，各 1 个直接调用方。

副作用核对：`core.quotePath` 只影响 git 的**路径输出**，不影响仓库读写语义，
对 `rev-parse` / `branch` / `log` 等无路径输出的命令无副作用。

## 解析层：新增函数

在 `pkg/wshrpc/wshremote/vcs.go` 新增两个纯函数（便于单测）：

### `decodeGitPathToken(token string) string`

- 输入一个 git 路径 token（可能带双引号）。
- 若以 `"` 开头：扫描到**未被转义**的结束引号，按 git `quote.c` 规则解码：
  - `\a \b \f \n \r \t \v` → 对应控制字符
  - `\\ \"` → 反斜杠 / 双引号
  - `\NNN`（1~3 位八进制）→ 单字节（按 UTF-8 字节序列还原）
- 若不带引号：原样返回（保留原始字节，不做 Unicode 变换）。

### `splitGitRenamePath(raw string) (string, bool)`

- 在**引号之外**寻找 ` -> ` 分隔符（git 重命名格式 `R  "old" -> "new"`）。
- 找到则返回右侧新路径；找不到返回原串与 false。

调用点改造：

| 函数 | 现状 | 改造后 |
|---|---|---|
| `parseGitStatus` | `strings.Trim(path, "\"")` | `splitGitRenamePath` → `decodeGitPathToken` |
| `parseGitCommitFiles` | 取最后一个字段直接用 | 最后一个字段先 `decodeGitPathToken` |

`parseGitStatus` 里现有的 `LastIndex(path, " -> ")` 会被引号内的 ` -> ` 误伤，
新函数按引号感知，行为更严格。

## 解析层：porcelain 首行空格（实施期发现的既有缺陷）

`loadGitRepoState` 原来用 `runVcsCommand` 取状态，而 `runVcsCommand` =
`runVcsCommandOutput(..., trimOutput=true, ...)` 会对整段输出做 `strings.TrimSpace`。
porcelain v1 每行开头是两列状态码，未暂存修改行以空格开头（` M path`），
第一行的行首空格被吃掉后，这一行变成 `M path`：

| 字段 | 期望 | 实际（trim 后） |
|---|---|---|
| 路径 | `first.txt` | `irst.txt`（左移一个字符） |
| `Staged` | false（未暂存） | true（被当成已暂存） |

修复：`loadGitRepoState` 改用 `runVcsCommandRaw`（不 trim），`parseGitStatus`
逐行处理，行尾 `\r` 已被 `strings.TrimRight(rawLine, "\r")` 处理，末尾空行被跳过。

选择「不 trim 输出」而不是「让解析器容忍缺列」，因为缺列的 porcelain 行
（`M path`）与合法的已暂存行（`M  path`）在字符层面无法区分，
只有在源头保留空格才无歧义。

## 为什么不用 `--porcelain=1 -z`

NUL 分隔（`-z`）确实永不加引号，但会改变 porcelain v1 的字段结构：
重命名条目变成两条 NUL 记录（原路径 + 新路径），解析器要整体重写，
并且 `RemoteVcsStatCommand` 里的另一处 `git status` 也要跟着改。
`-c core.quotePath=false` + 解析端反转义能覆盖同一批场景，改动面小得多，
且保留了对「含换行符的文件名」这一极端场景的现状行为（同样不保证，但不在本次范围）。

## 兼容性与风险

| 风险 | 评估 | 处置 |
|---|---|---|
| 老版本 git 不认 `-c` | git ≥ 1.7.2 支持，Windows/macOS/Linux 常规版本均满足 | 无需兜底 |
| 用户全局 `core.quotePath=true` | 命令层 `-c` 优先级更高，覆盖全局设置 | 解析层仍保留兜底 |
| svn 命令受影响 | `newVcsCommand` 只对 `command == "git"` 生效 | svn 行为零变化 |
| 前端契约变化 | `VcsFileStatus.path` 语义从「可能是转义串」变为「真实路径」，前端无需改 | 前端零 diff |

## 回滚

改动集中在 `pkg/wshrpc/wshremote/vcs.go` 三个函数 + 一个测试文件，
回滚 = 撤销该文件的改动即可，无数据迁移、无持久化状态变更。
