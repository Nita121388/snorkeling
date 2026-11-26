---
id: N-1126-perf-w2-2-overview-poll-storm
title: "Wave 2-2: Overview 看板回流与 15s 强刷风暴治理（columns memo、summary 等价去重、草稿态拆离 chip、workspace acquire 只收 agent 块）"
type: bug
priority: P0
severity: S2
status: open
origin: self
source: design/plans/snorkeling-perf-wave2-3-handoff-20261126.md
task: 11-26-perf-w2-2-overview-poll-storm
order: 100
touch: [frontend/app/session-overview/overview-board.tsx, frontend/app/session-overview/overview-board-rerender.test.tsx, frontend/app/session-overview/session-overview-session-cache.ts, frontend/app/session-overview/session-overview-session-cache.test.ts, frontend/app/session-overview/session-overview.tsx, frontend/app/session-overview/overview-card-send-panel.tsx, frontend/app/session-overview/send-status-chip.tsx, frontend/app/session-overview/send-status-chip-rerender.test.tsx, frontend/app/agent-status/agent-status-tab-aggregate.ts, frontend/app/agent-status/agent-status-tab-aggregate.test.ts]
rollback: null
budget: {minutes: 60}
releaseCandidate: false
createdAt: "2026-11-26T07:04:48Z"
---

# Wave 2-2: Overview 看板回流与 15s 强刷风暴治理（columns memo、summary 等价去重、草稿态拆离 chip、workspace acquire 只收 agent 块）

## 背景

_（待补）_

## 来源

- self：design/plans/snorkeling-perf-wave2-3-handoff-20261126.md

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-board-rerender.test.tsx frontend/app/session-overview/session-overview-session-cache.test.ts frontend/app/session-overview/send-status-chip-rerender.test.tsx frontend/app/agent-status/agent-status-tab-aggregate.test.ts && echo W2_2_TARGETED_OK` → `W2_2_TARGETED_OK`
- [ ] `npx vitest run frontend/app/session-overview frontend/app/agent-status && echo W2_2_SUITE_OK` → `W2_2_SUITE_OK`
- [ ] `node scripts/check-tsc-baseline.mjs && echo W2_2_TSC_OK` → `W2_2_TSC_OK`

## 记录

_（待补）_
