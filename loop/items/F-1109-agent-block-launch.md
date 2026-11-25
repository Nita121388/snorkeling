---
id: F-1109-agent-block-launch
title: "Agent Block 程序化创建：wsh agent launch + MCP 工具"
type: feature
priority: P2
status: open
origin: internal
source: "2026-11-09T00:00:00Z"
task: 11-09-agent-block-create
order: 110
touch: [pkg/agentcatalog/**, pkg/agentscope/**, pkg/wshrpc/wshrpctypes.go, pkg/wshrpc/wshclient/**, pkg/wshrpc/wshserver/**, pkg/agentmcp/**, pkg/agentcap/agentcap.go, pkg/waveobj/metamap.go, pkg/waveobj/metamap_test.go, cmd/wsh/cmd/wshcmd-agent-launch.go, cmd/wsh/cmd/wshcmd-launch.go, cmd/wsh/cmd/wshcmd-mcp.go, frontend/types/gotypes.d.ts, frontend/app/store/wshclientapi.ts, docs/project/agent-control-surface.md, docs/project/verify-ledger.md, scripts/verify/**, .trellis/tasks/11-09-agent-block-create/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 120, retries: 1}
releaseCandidate: false
createdAt: "2026-11-18T13:00:00Z"
feature: agent-block
---

# Agent Block 程序化创建：wsh agent launch + MCP 工具

## 背景

外部 agent / 脚本无法程序化拉起 claude/codex/pi/opencode 的 TUI agent block：`block open --view agent`
是 GUI 聊天块（且被禁），`launch defwidget@agent` 永远产出裸 codex。缺的是「受目录约束的建块入口」，
不是建块逻辑本身。用户 2026-11-18 明确：调用方要能选 **agent / Tab / 路径**。

## 实现要点

- `wsh agent launch --profile <p> [--model <id|provider/id>] [--tab …] [--cwd …]`；profile/model 只认
  `pkg/agentcatalog`，校验失败不建块（`E_PROFILE_UNKNOWN` / `E_MODEL_NOT_IN_CATALOG`）。
- 复用 `CreateBlockCommand`（唯一建块路径），meta 与 GUI `createAgentBlockDef` 对齐（term + cmd + agent:*）。
- 新 scope `launch`（介于 data 与 destructive）；MCP `snorkeling_agent_create`；GuideText 广告。
- `defwidget@agent` 改走 catalog 默认 profile（不再硬编码 codex）。
- `waveobj` 的 `GetArray` / `GetMap` 补 `[]string` / `map[string]string` 分支：Go 侧构造的 meta 读取
  必须与 JSON 往返后的语义一致，否则 `cmd:args` / `cmd:env` 会读空。

## 验收判据

- [x] `go build ./pkg/...` → 0
- [x] `go test ./pkg/agentcatalog ./pkg/agentscope ./pkg/agentmcp ./pkg/waveobj ./pkg/wshrpc/...` → all ok
- [x] 真机：`wsh agent launch --profile pi --tab new --wait --json` → `ok`、meta 完整（cmd=pi/controller=cmd/agent:*）、`--send` 后 pi 回复 OK
- [x] `pkg/agentscope` 用例：`data` 不满足 `launch`；`destructive` 满足 `launch`

## 记录

- 2026-11-18 22:55 真机（dev 实例 verify-agent-launch，跑完已关）：launch pi 成功，模型展开为
  `deepseek/deepseek-v4.1-flash`；bad model → `E_MODEL_NOT_IN_CATALOG` 且块数 12→12 不变；bad profile →
  `E_PROFILE_UNKNOWN`。踩坑沉淀：`ShellController` 先报 running 后建 input chan（发送侧限时重试）；
  pi 裸模型 id 跨 provider 歧义（目录有 provider 时展开 provider/id）。
- 2026-11-18：实现完成（agentcatalog env 透传 / scope / DTO / handler / CLI / MCP / cap / R7），
  生成绑定（generatets + generatego）已刷新。真机判据待 dev 实例；当前 `cmd/wsh/cmd` 被并行会话
  的 `wshcmd-session.go` 半成品改动阻塞（非本包）。见 `loop/INBOX.md`。
