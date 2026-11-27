---
id: N-1127-perf-codex-capture-poll
title: "Wave 3-1d: Codex 会话捕捉 29 分钟轮询每次重读解析全部 rollout jsonl → 退出取消 + mtime 缓存"
type: bug
priority: P2
severity: S2
status: open
origin: self
source: "HANDOFF.md 遗留 follow-up 3"
task: null
order: 100
touch: [pkg/blockcontroller/shellcontroller.go, pkg/blockcontroller/codex_capture_test.go]
rollback: null
budget: {minutes: 90}
releaseCandidate: false
createdAt: "2026-11-27T01:25:17Z"
---

# Wave 3-1d: Codex 会话捕捉 29 分钟轮询每次重读解析全部 rollout jsonl → 退出取消 + mtime 缓存

## 背景

_（待补）_

## 来源

- self：HANDOFF.md 遗留 follow-up 3

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test -p 1 ./pkg/blockcontroller" && echo CODEX_POLL_OK` → `CODEX_POLL_OK`

## 记录

_（待补）_
