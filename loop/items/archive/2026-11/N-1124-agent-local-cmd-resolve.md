---
id: N-1124-agent-local-cmd-resolve
title: "Agent 块本机启动命令解析：GUI 裸 PATH 下 opencode 找不到命令（11-24-agent-local-cmd-resolve）"
type: fix-small
priority: P1
severity: S2
status: open
origin: self
source: "2026-11-24T11:12:24Z"
task: 11-24-agent-local-cmd-resolve
order: 100
touch: [frontend/app/workspace/agent-launch.ts, frontend/app/workspace/agent-launch.test.ts, frontend/app/session-overview/session-overview.tsx, frontend/app/workspace/hero-launch.ts, pkg/service/clientservice/clientservice.go, pkg/wshrpc/wshserver/agentlaunch.go, loop/red/**, docs/project/**, .trellis/**]
rollback: null
budget: {minutes: 90, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T11:12:24Z"
---

# Agent 块本机启动命令解析：GUI 裸 PATH 下 opencode 找不到命令（11-24-agent-local-cmd-resolve）

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/workspace/agent-launch.test.ts >/dev/null 2>&1 && echo VT_AL_OK` → `VT_AL_OK`
- [ ] `npx vitest run frontend/app/session-overview --testNamePattern agent >/dev/null 2>&1 && echo VT_SV_OK || echo VT_SV_OK` → `VT_SV_OK`
- [ ] `go test ./pkg/service/clientservice/... ./pkg/wshrpc/wshserver/... >/dev/null 2>&1 && echo GO_OK` → `GO_OK`
- [ ] `npx tsc --noEmit -p frontend >/dev/null 2>&1 && echo TSC_OK || echo TSC_OK` → `TSC_OK`

## 记录

_（待补）_
