---
id: N-1126-perf-w1-2-aisessions-rpc-loadall
title: "Wave 1-2: AI Sessions P0-A/B（HTTP WriteTimeout 动态对齐、GetState ctx 取消、Summary/LiveSessionState 短预算、loadAll 真实 freshness 防清零）"
type: bug
priority: P0
severity: S2
status: open
origin: self
source: "2026-11-26T06:12:38Z"
task: 11-26-perf-w1-2-aisessions-rpc-loadall
order: 100
touch: [pkg/web/web.go, pkg/web/web_timeout_test.go, pkg/aisessions/chat/rpcprocess.go, pkg/aisessions/chat/session.go, pkg/aisessions/chat/getstate_ctx_test.go, pkg/aisessions/manager.go, pkg/aisessions/sqlite_index.go, pkg/aisessions/w1_2_rpc_loadall_test.go, pkg/service/aisessionsservice/aisessionsservice.go, pkg/service/aisessionsservice/chatcontrol.go, pkg/service/aisessionsservice/w1_2_budget_test.go]
rollback: null
budget: {minutes: 45}
releaseCandidate: false
createdAt: "2026-11-26T06:12:38Z"
---

# Wave 1-2: AI Sessions P0-A/B（HTTP WriteTimeout 动态对齐、GetState ctx 取消、Summary/LiveSessionState 短预算、loadAll 真实 freshness 防清零）

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test -p 1 ./pkg/web ./pkg/aisessions/chat" && echo W1_2_WEB_CHAT_OK` → `W1_2_WEB_CHAT_OK`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test -p 1 -run "TestLoadAll|TestSummaryMiss|TestSaveSummaryDoesNotZeroFreshness|TestLiveSessionState" ./pkg/aisessions ./pkg/service/aisessionsservice" && echo W1_2_AISESSIONS_OK` → `W1_2_AISESSIONS_OK`

## 记录

_（待补）_
