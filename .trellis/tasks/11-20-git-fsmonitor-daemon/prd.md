# 内部 git 调用禁用 fsmonitor 常驻 daemon（三处收口）

## Goal

Snorkeling 所有内部 git 命令统一带 `-c core.fsmonitor=false`，使内部调用不再在本机每仓拉起 40–80MB、永不退出的 `git fsmonitor--daemon` 常驻进程。

## Background / 确认事实（2026-11-20 会话实测）

- 11-19 wavesrv `fatal error: out of memory errno=1455`（ERROR_COMMITMENT_LIMIT）根因之一：67 个 fsmonitor daemon 占 2.85GB commit（findings：`.trellis/tasks/11-19-wavesrv-oom-flash-quit/findings-fsmonitor-leak-20261119.md`）。
- 本机 Git for Windows 系统级 `core.fsmonitor=true`（`D:/SoftWare/Git/etc/gitconfig`）；任何刷索引的 git 命令首跑即拉起 per-worktree 常驻 daemon，无空闲超时（`git fsmonitor--daemon -h` 仅 detach/ipc-threads/start-timeout）。
- 2026-11-20 09:04–09:13 复测：清零后 9 分钟内 Snorkeling 内部扫描又拉起 22 个 daemon（时间簇 09:07 x12、09:08 x7），对应 VCS 面板/目录预览的批量扫描。
- 内部 git 命令构造点共 3 处（2026-11-20 审计，修正昨天"2 处"结论）：
  - `pkg/wshrpc/wshremote/vcs.go:146` `newVcsCommand`（已有 `-c core.quotePath=false`，vcs.go 所有 git 调用唯一入口）
  - `pkg/sync/transport_git.go:92`（独立构造，已有 `-c core.quotePath=false`）
  - `pkg/hero/sync.go:53` `runGit`（裸 `exec.Command("git", ...)`，昨天漏掉）
- 性能实测（同仓交替跑 `git status --porcelain=v1 -uall`，900–4500 文件仓）：带 daemon 2993/1906ms、1056/394ms、352/408ms vs 强制关闭 1746/2316ms、271/369ms、367/329ms——无可测损失（差异在磁盘缓存噪声内；本机无超大仓）。
- `-c` 优先级高于仓库级/系统级配置，不会被反向覆盖，不半生效；git 2.45 传布尔 false 合法禁用。

## Requirements

- **R1（三处收口）**：上述 3 处构造点生成的每条内部 git argv 都含 `-c core.fsmonitor=false`。vcs.go 处与现有 `core.quotePath=false` 同一模式追加；transport_git.go 同理；hero/sync.go 的 `runGit` 在 fullArgs 前部插入。
- **R2（红证单测）**：新增断言测试，逐一断言三处构造出的 argv 含 `-c core.fsmonitor=false`；改前该断言必须失败（红证），改后全绿。
- **R3（不做的事）**：
  - 不改系统级 gitconfig（那是机器配置，另行决策）。
  - 不清存量 daemon（一次性运维动作，会话内已做）。
  - 不影响用户终端块里手敲的 git（走 shell，不经这三处）。
  - 不做设置项/开关（本轮硬编码；若将来有"用户特意开 fsmonitor 的超大仓"诉求再升级，先记 limitation）。

## Acceptance Criteria

- [ ] `go build ./...` 0 error。
- [ ] 红证：在改动前源上跑新增断言 → 至少 3 条失败（三处各一）。
- [ ] `go test ./pkg/wshrpc/wshremote/ ./pkg/sync/ ./pkg/hero/` 全绿，含新增 `core.fsmonitor=false` 断言。
- [ ] 白名单外零改动（touch 清单之外无文件变化）。
- [ ] 真机验收（发版后补）：清零 daemon → 用新版 app 刷 VCS 面板 → `git fsmonitor--daemon` 进程数保持 0。
