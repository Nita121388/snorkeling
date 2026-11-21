---
id: F-1121-agent-roundtrip
title: "ACS：agent roundtrip（send --wait-reply 等回合完成收回复）+ session wait"
type: arch
priority: P1
status: open
origin: self
source: "nita 2026-11-21 追问：多 agent 之间怎么通信；本包补「等回合完成」原语"
task: 11-21-agent-roundtrip
order: 110
touch: [pkg/wshrpc/wshrpctypes.go, pkg/wshrpc/wshclient/wshclient.go, pkg/wshrpc/wshserver/agentsend.go, pkg/wshrpc/wshserver/replysignal.go, pkg/wshrpc/wshserver/session_commands.go, pkg/wshrpc/wshserver/agentdispatch_rpc.go, cmd/wsh/cmd/wshcmd-agent-launch.go, cmd/wsh/cmd/wshcmd-mcp.go, pkg/agentscope/scope.go, cmd/wsh/cmd/wshcmd-session.go, pkg/agentmcp/tools.go, pkg/agentmcp/server_test.go, frontend/types/gotypes.d.ts, frontend/app/store/wshclientapi.ts, scripts/verify/agent-roundtrip/**, scripts/verify/README.md, docs/project/verify-ledger.md, docs/project/ui-verify-playbook.md, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 480, retries: 2}
releaseCandidate: false
createdAt: "2026-11-21T14:57:00Z"
---

# ACS：agent roundtrip（send --wait-reply 等回合完成收回复）+ session wait

## 背景

`agent send` 现为 fire-and-forget：注入成功即返回，回复只能靠反复读会话。多 agent 通信缺「等对方答完并拿到回复」这一段。会话数据还会不全（pi 首条回复前无文件、半截 JSON、按预算截断），所以完成判定必须三信号交集，不能只信新 assistant turn。

## 来源

- self：nita 2026-11-21 追问「多个 agent Block 之间通信」；对账 Herdr `agent wait --until` / Paseo `waitForFinish` / Orca 唤醒模型后定 v1 同步等待 + `--no-wait` 逃生口。需求全文见 `.trellis/tasks/11-21-agent-roundtrip/prd.md`。

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/wshrpc/wshserver ./pkg/agentcontrol ./pkg/agentmcp ./cmd/wsh/cmd -count=1"` → `ok`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go build ./...; if ($LASTEXITCODE -eq 0) { echo BUILD_OK }"` → `BUILD_OK`
- [ ] `node scripts/verify/index.mjs --area agent-roundtrip` → `12/12`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/wshrpc/wshserver -run 'TestReplyCompleteMatrix|TestReplySettled' -count=1"` → `ok`

## 记录

- 2026-11-21 建包（arch）。门链 G1(H)/G2/G5/G6(H)/G7(H)。
- 规划三件套：`.trellis/tasks/11-21-agent-roundtrip/{prd,design,implement}.md`。
- 已知最大坑预登记：CLI/MCP 的 RPC timeout 必须放大到 > `--reply-wait-ms`，否则同步等待一律假失败（implement §回滚点）。
