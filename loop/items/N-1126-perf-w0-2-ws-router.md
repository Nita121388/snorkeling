---
id: N-1126-perf-w0-2-ws-router
title: "Wave 0-2: 修 WebSocket 写 deadline 假断连、WshRpcProxy 并发关闭 panic 与 WshRouter 泄漏"
type: bug
priority: P0
severity: S2
status: open
origin: self
source: "2026-11-26T04:55:19Z"
task: 11-26-perf-w0-2-ws-router
order: 100
touch: [pkg/web/ws.go, pkg/web/ws_test.go, pkg/wshutil/wshproxy.go, pkg/wshutil/wshproxy_test.go, pkg/wshutil/wshrouter.go, pkg/wshutil/wshrouter_leak_test.go]
rollback: null
budget: {minutes: 40}
releaseCandidate: false
createdAt: "2026-11-26T04:55:19Z"
---

# Wave 0-2: 修 WebSocket 写 deadline 假断连、WshRpcProxy 并发关闭 panic 与 WshRouter 泄漏

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test -race ./pkg/web ./pkg/wshutil" && echo W0_2_GO_OK` → `W0_2_GO_OK`

## 记录

_（待补）_
