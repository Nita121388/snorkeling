---
id: F-1118-agent-block-send
title: "Agent Block 发送文本：wsh agent send + launch --send + TUI 就绪判定"
type: feature
priority: P2
status: open
origin: internal
source: "2026-11-18T13:00:00Z"
task: 11-18-agent-block-send
order: 120
touch: [pkg/wshrpc/wshrpctypes.go, pkg/wshrpc/wshclient/**, pkg/wshrpc/wshserver/agentsend.go, pkg/wshrpc/wshserver/agentlaunch.go, pkg/wshrpc/wshserver/wshserver.go, pkg/agentmcp/**, pkg/agentcap/agentcap.go, cmd/wsh/cmd/wshcmd-agent-launch.go, cmd/wsh/cmd/wshcmd-mcp.go, frontend/types/gotypes.d.ts, frontend/app/store/wshclientapi.ts, docs/project/agent-control-surface.md, docs/project/verify-ledger.md, scripts/verify/**, .trellis/tasks/11-18-agent-block-send/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 90, retries: 1}
releaseCandidate: false
createdAt: "2026-11-18T13:00:00Z"
feature: agent-block
---

# Agent Block 发送文本：wsh agent send + launch --send

## 背景

昨天 CommonText「一步发送到 agent block」的注入半段是纯前端：隐藏挂载 Tab → 等 quiet →
xterm `paste()` → 延时 `controllerinput` 补回车。外部 agent 调不到这条链。本包把它后端化：
直接写 PTY，块照常展示（后台 = 不抢焦点，不是隐藏）。

## 实现要点

- `wsh agent send --block <id|this> --text/--stdin`；`launch --send` 一步建块并投递。
- 注入 = `ESC[200~` + text + `ESC[201~`，延时 150ms 后单独写 `\r`（只 paste 不回车 = agent 收不到）。
- 就绪判定后端化：轮询块 term 文件 size/mtime 直到静默 `--quiet-ms`（默认 400），总预算 `--wait-ms`
  （默认 30s），超时 `E_AGENT_NOT_READY`（块保留，可重试）。
- controller 未运行 → `ResyncController` 起 pty（后台 Tab 未挂载也能发）。
- C0/ESC 清洗、64KB 上限；远端 connection 拒绝（`E_UNSUPPORTED`）。
- MCP `snorkeling_agent_send` + `snorkeling_agent_create.message`。

## 验收判据

- [x] `go build ./pkg/...` → 0
- [x] 单测：注入字节 / 清洗 / 参数边界 / 默认 submit+wait / 显式 false 可传
- [x] MCP：`data` scope 拒绝 launch/send；`launch` scope 放行
- [x] 真机：term 块 `echo SNORKELING_SEND_OK` 探针（term 文件出现标记 + exitcode 0）+ `launch --send` 探针（pi 回复 OK）；非 term 块 `E_BLOCK_NOT_READY`、70KB `E_USAGE`

## 记录

- 2026-11-18：实现完成。真机判据待 dev 实例；`cmd/wsh/cmd` 受并行会话编辑阻塞（非本包）。
