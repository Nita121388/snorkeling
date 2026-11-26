---
id: N-1126-perf-w0-3-preload-hooklog
title: "Wave 0-3: 关闭 hover 幽灵隐藏 Tab 预加载并给 agentstatus hook 日志加 5MB 轮转"
type: bug
priority: P0
severity: S2
status: open
origin: self
source: "2026-11-26T04:55:21Z"
task: 11-26-perf-w0-3-preload-hooklog
order: 100
touch: [frontend/app/workspace/workspace.tsx, frontend/app/workspace/preload-tabs.ts, frontend/app/workspace/preload-tabs.test.ts, pkg/agentstatus/hookinstall.go, pkg/agentstatus/hookinstall_test.go]
rollback: null
budget: {minutes: 30}
releaseCandidate: false
createdAt: "2026-11-26T04:55:21Z"
---

# Wave 0-3: 关闭 hover 幽灵隐藏 Tab 预加载并给 agentstatus hook 日志加 5MB 轮转

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/workspace/preload-tabs.test.ts && echo W0_3_PRELOAD_OK` → `W0_3_PRELOAD_OK`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/agentstatus/..." && echo W0_3_HOOKLOG_OK` → `W0_3_HOOKLOG_OK`

## 记录

_（待补）_
