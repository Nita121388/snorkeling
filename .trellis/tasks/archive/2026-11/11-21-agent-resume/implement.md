# Agent Resume · 执行计划

门链：G1（人签 prd）→ G2（红证）→ 实现 → G5（合规）→ G7（人验收）。取件前 `queue run --id F-1121-agent-resume` 校验门清。

## 0. 前置

- [ ] 0.1 `node E:/primary/projects/loop/bin/loop.mjs queue run --id F-1121-agent-resume --dry-run` 门清
- [ ] 0.2 `python .trellis/scripts/task.py start 11-21-agent-resume`（Trellis 状态 → in_progress）

## 1. G2 红证（先写判据，实测转红）

- [ ] 1.1 `pkg/agentcontrol/restore_test.go`：五组 parity golden（claude+vendor / claude 无 vendor / codex / opencode / pi）+ 未知 source 拒绝
- [ ] 1.2 `pkg/wshrpc/wshserver/agentresume_test.go`：参数校验（remote 拒绝 / gemini E_USAGE / --tab new 无 workspace）
- [ ] 1.3 `pkg/agentmcp/server_test.go` 或 `tools_test.go`：两个新工具 name/schema/scope 快照
- [ ] 1.4 `cmd/wsh/cmd/wshcmd-agent-resume_test.go`：flag→DTO 绑定
- [ ] 1.5 红证落盘：`go test ./pkg/agentcontrol ./pkg/wshrpc/wshserver ./cmd/wsh/cmd ./pkg/agentmcp -run 'Resume|Mark' -count=1` → 失败输出存 `loop/red/F-1121-agent-resume.txt`
- [ ] 1.6 `loop.mjs queue gate --id F-1121-agent-resume --gate g2 --red-proof loop/red/F-1121-agent-resume.txt`

## 2. DTO 与 resolver

- [ ] 2.1 `pkg/wshrpc/wshrpctypes.go`：AgentResumeRequest/Result、SessionMarkRequest/Result
- [ ] 2.2 `pkg/agentcontrol/restore.go`：`ResolveRestoreContext` + `BuildResumeBlockMeta`（复用 ccswitch）
- [ ] 2.3 尝试把 vendor 解析从 `aisessionsservice.RestoreContext` 抽到共享函数（D1）；失败则退化双实现 + parity 双锁，并在 prd Notes 回写

## 3. RPC handler

- [ ] 3.1 `pkg/wshrpc/wshserver/agentresume.go`：AgentResumeCommand（design §6 时序）
- [ ] 3.2 `pkg/wshrpc/wshserver/session_commands.go`：SessionMarkCommand
- [ ] 3.3 wshclient 方法注册（`pkg/wshrpc/wshclient/wshclient.go`）

## 4. CLI

- [ ] 4.1 `cmd/wsh/cmd/wshcmd-agent-resume.go`：`agent resume`（flags 全量 + --json + 文本输出）
- [ ] 4.2 `cmd/wsh/cmd/wshcmd-agent.go`：注册 resume 子命令
- [ ] 4.3 `cmd/wsh/cmd/wshcmd-session.go`：`session mark`（--unmark/--json）

## 5. MCP

- [ ] 5.1 `pkg/agentmcp/tools.go`：`snorkeling_agent_resume`（scope launch）、`snorkeling_session_mark`（scope data）
- [ ] 5.2 schema/scope 快照测试通过

## 6. 类型与构建

- [ ] 6.1 重生成 gotypes：`node scripts/run-task.mjs gen-gotypes`（以 repo Taskfile 实际任务名为准；产出 `frontend/types/gotypes.d.ts` 仅包含 DTO 差异）
- [ ] 6.2 `go build ./...` → exit 0
- [ ] 6.3 `go test ./pkg/agentcontrol ./pkg/wshrpc/wshserver ./pkg/agentmcp ./cmd/wsh/cmd -count=1` → 全绿

## 7. 真机验证（G7 证据，全部需要真机）

- [ ] 7.1 新建 verify area：`cp -r scripts/verify/_template scripts/verify/agent-resume`，剧本覆盖 AC4-AC8；登记 `scripts/verify/README.md`
- [ ] 7.2 `node scripts/verify/index.mjs --area agent-resume` → exit 0（0 全绿 / 1 断言失败 / 2 环境错误）
- [ ] 7.3 手动补充剧本（无法自动化的）：pi / codex 各一次真实恢复 + `--send 'reply with exactly: RESUME_OK'`，输出存档 `verify-runs/agent-resume/`
- [ ] 7.4 marked 真机：mark → `session list --marked true` 命中 → unmark 复原
- [ ] 7.5 `verify-ledger.md` 入账一行；`docs/project/ui-verify-playbook.md` 回写新坑（无新坑也要写一行「无」）

## 8. G5 合规

- [ ] 8.1 `go vet ./pkg/agentcontrol ./pkg/wshrpc/... ./cmd/wsh/cmd`
- [ ] 8.2 无新依赖（deps 白名单）；无前端改动（除 gotypes）
- [ ] 8.3 `loop.mjs queue gate --id F-1121-agent-resume --gate g5`
- [ ] 8.4 三个新文件都带 license header；注释引用 design 编号

## 9. 收尾

- [ ] 9.1 `detect_changes`（GitNexus）确认只动 whitelist 内符号
- [ ] 9.2 spec 回写（`.trellis/spec/snorkeling-docs/` 补「resume 契约 + meta parity」一节）
- [ ] 9.3 commit（`feat(resume): ...` + `11-21-agent-resume`），Trellis `task.py archive`
- [ ] 9.4 loop：`note` → 等 G7（人验收打分）

## 回滚点

- 2.3 抽离失败：只回退共享抽离，保留 agentcontrol 独立实现（其余不受影响）。
- 真机 7.3 发现 shellcontroller 不识别 meta：停发 PR，先修 meta 契约（改的是 shellcontroller 语义，属 out-of-scope → park）。
