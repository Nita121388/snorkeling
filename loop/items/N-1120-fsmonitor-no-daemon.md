---
id: N-1120-fsmonitor-no-daemon
title: "内部 git 调用禁用 fsmonitor 常驻 daemon（三处收口）"
type: fix-small
priority: P1
severity: S2
status: open
origin: self
source: "2026-11-20T01:26:47Z"
task: 11-20-git-fsmonitor-daemon
order: 100
touch: [pkg/wshrpc/wshremote/vcs.go, pkg/wshrpc/wshremote/vcs_test.go, pkg/sync/transport_git.go, pkg/sync/transport_git_test.go, pkg/hero/sync.go, pkg/hero/sync_test.go, docs/project/verify-ledger.md]
rollback: null
budget: {minutes: 40, retries: 2}
releaseCandidate: false
createdAt: "2026-11-20T01:26:47Z"
---

# 内部 git 调用禁用 fsmonitor 常驻 daemon（三处收口）

## 背景

本机系统级 `core.fsmonitor=true` 让每次刷索引的 git 命令在对应仓库拉起一个 40–80MB、无空闲超时、永不退出的 `fsmonitor--daemon`。Snorkeling 的 VCS 扫描（`vcs.go` 对 basePath 下 depth 3 逐仓 `git status`）、同步传输、hero 同步三条内部路径都会触发它，累积到几十个后吃满整机 commit（11-19 `errno=1455` OOM 闪退）。内部 git 命令构造点审计为 3 处，统一加 `-c core.fsmonitor=false`。不改系统 gitconfig、不影响用户终端里的 git。

## 来源

- self：nita 2026-11-20 会话 —— fsmonitor 泄漏归因调查后决定做产品侧收口（方案 A）；实测关掉后本机 900–4500 文件仓 status 耗时无差异。

## 验收判据

- [ ] `go build ./... && echo BUILD_OK` → `BUILD_OK`
- [ ] `go test -count=1 ./pkg/wshrpc/wshremote/ ./pkg/sync/ ./pkg/hero/ >NUL 2>&1 && echo PKG_TESTS_OK` → `PKG_TESTS_OK`
- [ ] `go test -count=1 -v -run "Fsmonitor|GitGlobalConfigArgs:None" ./pkg/wshrpc/wshremote/ ./pkg/sync/ ./pkg/hero/ >NUL 2>&1 && echo FSMONITOR_ASSERTS_OK` → `FSMONITOR_ASSERTS_OK`

## 记录

- 2026-11-20 G2 红证（改动前源）：三处新断言全红 —— vcs 断言 FAIL（argv 只有 `-c core.quotePath=false`）、sync 编译红 `undefined: gitGlobalConfigArgs`、hero 编译红 `undefined: gitArgs`。
- 2026-11-20 实施：vcs.go `newVcsCommand` 追加 `-c core.fsmonitor=false`；transport_git.go 提取 `gitGlobalConfigArgs()`；hero/sync.go 提取 `gitArgs()`。旧断言 `TestNewVcsCommandDisablesGitPathQuoting` 改按「跳过全部 -c 对后找子命令」适配。
- 未做：系统级 gitconfig、存量 daemon 清理、设置开关（口径见 prd R3）。
