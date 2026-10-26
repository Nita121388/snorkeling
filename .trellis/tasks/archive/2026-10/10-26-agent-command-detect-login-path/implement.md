# Implement：本地 Agent 命令探测的 PATH 回退

## 前提

- 已读 `.trellis/spec` 相关 spec（backend / contract）。
- impact 分析：`FindCommand` 为 RPC 方法，符号图无调用边（预期）；文本搜索确认调用面为
  `frontend/app/workspace/widgets.tsx:1907`（New Agent 探测）与 `:2109`（ForConnection）。

## 步骤

### 1. 修改 `pkg/service/clientservice/clientservice.go`

- [ ] 新增 `commonCandidateDirs(home string) []string`（单一事实来源，含 `~/.opencode/bin`）。
- [ ] 新增 `isExecutableFile(path string) bool`。
- [ ] 新增 `resolveCommandWithFallback(command string) string`（先登录 shell PATH，再候选目录）。
- [ ] 新增 `getLoginShellPath() []string`（sync.Once + 3s 超时，仅 POSIX）。
- [ ] 新增 `parsePathFromEnvOutput(out string) []string`（从 `env` 输出解析 PATH 行）。
- [ ] 改 `FindCommand`：`exec.LookPath` 失败后调用 `resolveCommandWithFallback`。
- [ ] 改 `makeFindCommandScript`：目录列表由 `commonCandidateDirs` 生成（去重、HardQuote 安全）。

### 2. 补测试 `pkg/service/clientservice/clientservice_test.go`

- [ ] `TestCommonCandidateDirsIncludesOpencode`
- [ ] `TestFindCommandFallbackToCandidateDir`（t.Setenv HOME + 写假可执行文件）
- [ ] `TestParsePathFromEnvOutput`
- [ ] `TestMakeFindCommandScriptUsesSharedDirs`（断言含 `~/.opencode/bin`）
- [ ] 保持现有 `TestFindCommandOnShellClientUsesRemoteFallbackScript` 通过（其断言含
      `"$HOME/.local/bin"`、`"/opt/homebrew/bin"`、`"/usr/local/bin"`，改造后仍需满足）

### 3. 验证命令

```bash
# 定向测试
cd /Users/nita/Primary/projects/snorkeling
./.tools/go/bin/go test ./pkg/service/clientservice/...
# 若本地工具链未就绪
npm run setup
node scripts/run-task.mjs go:test # 或项目约定的 task 名

# 编译
go build ./pkg/service/clientservice/...
```

### 4. 手动验证（GUI 场景）

```bash
# 模拟 GUI 裸 PATH
env -i HOME=$HOME SHELL=/bin/zsh PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  go test ./pkg/service/clientservice/... -run TestFindCommandFallback
```

期望：即使 PATH 只有系统目录，`~/.opencode/bin/opencode` 仍能被回退探测到。

### 5. 收尾

- [ ] `python3 ./.trellis/scripts/task.py finish`
- [ ] 更新 spec（若产生新的跨模块约定）
- [ ] commit + push

## 回滚点

单文件为主（clientservice.go + 测试），回滚只需 revert 该 commit。

## 假设

- `DetectLocalShellPath()` 在 macOS/Linux 可用；解析失败时静默跳过，行为退化为“仅候选目录”
  （仍修复 opencode/codex/claude/pi 的典型安装位置）。
- 不引入新的第三方依赖。
