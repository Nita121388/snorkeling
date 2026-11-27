---
id: N-1127-perf-w3-1b-remote-sysinfo
title: "Wave 3-1b: 远端 sysinfo 订阅状态转发 RPC（main → connserver，砍掉远端每秒无条件采集）"
type: bug
priority: P2
severity: S2
status: open
origin: self
source: "HANDOFF.md 遗留 follow-up 1"
task: null
order: 100
touch: [pkg/wshrpctypes/, pkg/wshrpc/wshremote/sysinfo.go, pkg/wshrpc/wshserver/, pkg/wps/]
rollback: null
budget: {minutes: 90}
releaseCandidate: false
createdAt: "2026-11-27T01:25:06Z"
---

# Wave 3-1b: 远端 sysinfo 订阅状态转发 RPC（main → connserver，砍掉远端每秒无条件采集）

## 背景

_（待补）_

## 来源

- self：HANDOFF.md 遗留 follow-up 1

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test -p 1 ./pkg/wshrpc/... ./pkg/wps/..." && echo W3_1B_OK` → `W3_1B_OK`

## 记录

_（待补）_
