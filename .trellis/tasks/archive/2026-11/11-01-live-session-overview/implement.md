# 实施清单：实时运行会话总览

## 前置

- [ ] 读 `design/plans/agent-control-surface.md` §6.4 / §7.6 / §13 P0.0
- [ ] 读 `.trellis/spec/snorkeling-docs/backend/aisessions-scan-contract.md`
- [ ] 确认 `task.py current` 指向本任务

## 步骤

1. `pkg/agentcontrol/types.go`：DTO + `Version` + 错误码常量（`E_NOT_FOUND` 等）。
2. `pkg/agentcontrol/redact.go`：meta allowlist + 正则脱敏（单测）。
3. `pkg/aisessions/chat/manager.go`：新增 `LiveChatInfo` + `ActiveSessions()`（含测试）。
4. `pkg/agentcontrol/session.go`：
   - `BuildLiveSessions(ctx, req)`：候选块收集 → 并行取 chat state / summary → 合并 → 过滤/排序。
   - `ResolveSessionForBlock(ctx, blockId)`。
5. `pkg/wshrpc/wshrpctypes.go`：新增 `SessionLiveCommand` / `SessionGetCommand` / `SessionListCommand`
   （只读；返回 `agentcontrol.*` 类型）。
6. `pkg/wshrpc/wshserver/session_commands.go`：3 个 handler，薄封装，超时与 partial 语义。
7. `cmd/wsh/cmd/wshcmd-session.go`：`live/get/list/for-block` 四个子命令 + `--json` + 人类可读表格。
8. `task generate`（重生成 `wshclient` / TS 绑定 / gotypes）。
9. 单测 + golden + `go test ./pkg/agentcontrol/... ./pkg/aisessions/chat/... ./pkg/wshutil/...`
10. 真机验证脚本（见下）。

## 验证命令

```bash
# 后端
go build ./...
go test ./pkg/agentcontrol/... ./pkg/aisessions/chat/... ./pkg/aisessions/...
# 绑定
node scripts/run-task.mjs generate   # 或 task generate
# 前端类型（若 generate 改了 gotypes）
npx tsc --noEmit -p frontend
```

## 真机验收

```bash
wsh session live --json | jq '.sessions | length'
wsh session live --json | jq '.sessions[] | {provider, state: .issue.state, phase: .issue.phase, title}'
wsh session get this --json
wsh session list --source pi --limit 5 --json
wsh session for-block this --json
```

对照 UI：正在跑的 agent 数量、状态点、标题一致；kill 一个后状态按 TTL 变 stale。

## 回滚点

- RPC 是新增，不改既有命令 → 回滚 = revert 本任务 commit。
- 若 `task generate` 产物异常，`git checkout -- frontend/types/gotypes.d.ts frontend/app/store/wshclientapi.ts pkg/wshrpc/wshclient/wshclient.go`。

## Review Gate

- [ ] 无 `ScanSummaries` 直接调用
- [ ] 无新前端文件
- [ ] 无 DB 写入 / 无 wps 事件
- [ ] `--json` 字段名与 §7.6 一致
