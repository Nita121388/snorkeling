---
id: N-1127-perf-pty-output-batch
title: "Wave 3-1c: PTY 4KB read 直发 base64 广播 → 32KB 缓冲 + 4-8ms 合批"
type: bug
priority: P2
severity: S2
status: open
origin: self
source: "HANDOFF.md 遗留 follow-up 3 + 全项目排查 P1"
task: null
order: 100
touch: [pkg/blockcontroller/shellcontroller.go, pkg/blockcontroller/pty_output_test.go]
rollback: null
budget: {minutes: 90}
releaseCandidate: false
createdAt: "2026-11-27T01:25:17Z"
---

# Wave 3-1c: PTY 4KB read 直发 base64 广播 → 32KB 缓冲 + 4-8ms 合批

## 背景

_（待补）_

## 来源

- self：HANDOFF.md 遗留 follow-up 3 + 全项目排查 P1

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test -p 1 ./pkg/blockcontroller" && echo PTY_BATCH_OK` → `PTY_BATCH_OK`

## 记录

_（待补）_
