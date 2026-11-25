---
id: N-1124-agent-cmd-resolve2
title: "Agent 块本机启动命令解析：GUI 裸 PATH 下 opencode 找不到命令（11-24-agent-local-cmd-resolve）"
type: fix-small
priority: P1
severity: S2
status: open
origin: self
source: "2026-11-24T13:06:40Z"
task: 11-24-agent-local-cmd-resolve
order: 100
touch: [frontend/app/workspace/agent-launch.ts, frontend/app/workspace/agent-launch.test.ts, frontend/app/session-overview/session-overview.tsx, frontend/app/workspace/widgets.tsx, frontend/app/workspace/hero-launch-window.tsx, pkg/service/clientservice/clientservice.go, pkg/wshrpc/wshserver/agentlaunch.go, pkg/wshrpc/wshserver/agentlaunch_test.go, loop/red/**, docs/project/**, .trellis/**]
rollback: null
budget: {minutes: 90, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T13:06:40Z"
feature: agent-block
---

# Agent 块本机启动命令解析：GUI 裸 PATH 下 opencode 找不到命令（11-24-agent-local-cmd-resolve）

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/workspace/agent-launch.test.ts frontend/app/workspace/hero-launch.test.ts frontend/app/session-overview/overview-add-agent-modal.dom.test.tsx >/dev/null 2>&1 && echo VT_OK` → `VT_OK`
- [ ] `go test ./pkg/service/clientservice/... ./pkg/wshrpc/wshserver/... >/dev/null 2>&1 && echo GO_OK` → `GO_OK`
- [ ] `npx eslint frontend/app/workspace/agent-launch.ts frontend/app/session-overview/session-overview.tsx >/dev/null 2>&1 && echo LINT_OK` → `LINT_OK`
- [ ] `grep -q shouldUseLocalResolvedCmd frontend/app/workspace/agent-launch.ts && grep -q resolveAgentCmdForLaunch pkg/wshrpc/wshserver/agentlaunch.go && echo GUARD_OK` → `GUARD_OK`

## 记录

_（待补）_
