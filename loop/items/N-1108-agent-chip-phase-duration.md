---
id: N-1108-agent-chip-phase-duration
title: "状态徽章时长按当前阶段段计算（phaseSince），而非 working 总时长"
type: bug
priority: P1
status: open
origin: self
source: "nita 2026-11-07：状态徽章显示的是 working 总时长而不是当前工具/阶段的时长"
task: 11-08-agent-chip-phase-duration
order: 100
touch: [pkg/agentstatus/**, frontend/app/agent-status/**, frontend/app/view/aisessions/session-run-badge-view.ts, frontend/types/gotypes.d.ts, docs/project/verify-ledger.md, .trellis/tasks/11-08-agent-chip-phase-duration/**, .trellis/spec/**]
rollback: "git revert 单提交；phaseSince 是新增可选字段，旧读路径回落 activeSince，无数据迁移"
budget: {minutes: 60, retries: 2}
releaseCandidate: false
createdAt: "2026-11-08T05:58:20Z"
---

# 状态徽章时长按当前阶段段计算（phaseSince），而非 working 总时长

## 背景

_（待补）_

## 来源

- self：nita 2026-11-07：状态徽章显示的是 working 总时长而不是当前工具/阶段的时长

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/agentstatus"` → `ok`
- [ ] `npx vitest run frontend/app/agent-status` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=47`

## 记录

_（待补）_
