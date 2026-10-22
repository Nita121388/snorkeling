# Implement — VCS Block 中文路径乱码修复

## 改动范围

| 文件 | 改动 |
|---|---|
| `pkg/wshrpc/wshremote/vcs.go` | `newVcsCommand` 加 `-c core.quotePath=false`；新增 `decodeGitPathToken` / `splitGitRenamePath`；改造 `parseGitStatus` / `parseGitCommitFiles` |
| `pkg/wshrpc/wshremote/vcs_test.go` | 新增单元测试 + 集成测试 |

前端零改动。

## 步骤清单

1. **命令层**：在 `newVcsCommand` 中对 `command == "git"` 前置 `-c core.quotePath=false`。
   - 注意：`args` 切片不可复用调用方底层数组，用 `append([]string{...}, args...)` 新建切片。
2. **解析层**：新增 `decodeGitPathToken(token string) string`。
   - 处理 `"` 包裹 + C 风格转义：`\a \b \f \n \r \t \v \\ \"` 与 `\NNN`（1~3 位八进制）。
   - 非引号 token 原样返回。
   - 未闭合引号时按「到字符串末尾」处理，不 panic。
3. **解析层**：新增 `splitGitRenamePath(raw string) (string, bool)`。
   - 只在引号之外找 ` -> `；命中返回右侧 token 与 true，否则返回原串与 false。
4. **改造 `parseGitStatus`**：`line[3:]` → `splitGitRenamePath` → `decodeGitPathToken`；
   保留现有 `Staged` / `Untracked` 判定与排序逻辑不变。
5. **改造 `parseGitCommitFiles`**：路径字段先 `decodeGitPathToken` 再 `filepath.ToSlash`。
6. **修掉 porcelain 首行空格缺陷**：`loadGitRepoState` 的 `git status` 调用从
   `runVcsCommand`（trim）改成 `runVcsCommandRaw`（不 trim），并加注释说明原因。
7. **测试**：
   - `TestDecodeGitPathTokenDecodesUnicodeEscapes`：`"\346\226\260...txt"` → `新建文件.txt`。
   - `TestDecodeGitPathTokenKeepsPlainPaths`：普通路径原样返回。
   - `TestSplitGitRenamePathIgnoresSeparatorInsideQuotes`。
   - `TestParseGitStatusDecodesQuotedUnicodePath`。
   - `TestParseGitCommitFilesDecodesQuotedUnicodePath`。
   - `TestNewVcsCommandDisablesGitPathQuoting`：git 参数前置 `-c core.quotePath=false`，
     svn 不受影响，且不污染调用方切片。
   - `TestLoadGitRepoStateKeepsFirstStatusLinePath`：回归 R4（首行路径不得左移）。
   - `TestRemoteVcsRepositoriesCommandDecodesUnicodePaths`（集成）：真实 git 仓库 + 中文文件名，
     断言 `repo.status` 里路径为中文、diff 请求返回内容。
8. **验证**：
   - `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test -count=1 ./pkg/wshrpc/wshremote"`
   - `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go build ./..."`
   - `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go vet ./pkg/wshrpc/wshremote"`
   - `node .gitnexus/run.cjs detect-changes`（提交前核对影响面）
9. **提交前**：`git diff` 只应包含 `pkg/wshrpc/wshremote/` 两个文件。

## Review Gates

- Gate 1：`decodeGitPathToken` 的转义表与 git `quote.c` 一致（`\NNN` 必须按字节还原，1~3 位）。
- Gate 2：`parseGitStatus` 对 `R  "old" -> "new"` 取的是**新路径**且已解码（与旧行为一致）。
- Gate 3：既有英文路径测试全绿（行为零变化）。
- Gate 4：前端 `frontend/` 无 diff。
- Gate 5：`git status` 输出不得被整体 trim（porcelain 首行以空格开头，trim 会让路径左移）。

## 回滚点

改动只落在 `pkg/wshrpc/wshremote/vcs.go` 与其测试文件；
`git checkout -- pkg/wshrpc/wshremote/` 即可完全回滚，无数据迁移。
