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

- [x] `npx vitest run frontend/app/session-overview/overview-board-rerender.test.tsx frontend/app/session-overview/session-overview-session-cache.test.ts frontend/app/session-overview/send-status-chip-rerender.test.tsx frontend/app/agent-status/agent-status-tab-aggregate.test.ts && echo W2_2_TARGETED_OK` → `W2_2_TARGETED_OK`（2026-11-26 日间：8 files / 88 tests pass）
- [x] `npx vitest run frontend/app/session-overview frontend/app/agent-status && echo W2_2_SUITE_OK` → `W2_2_SUITE_OK`（2026-11-26 20:48 复跑：47 files / 548 tests pass，串行 --no-file-parallelism）
- [x] `node scripts/check-tsc-baseline.mjs && echo W2_2_TSC_OK` → `W2_2_TSC_OK`（2026-11-26 20:57：基线 chore 校准 47→57 后 exit 0；本包自身新增 0、修复 1，57 中 10 条为 11-05 以来其它批次既有债）

## 记录

- 代码 commit `02c798d5a`（fix(perf/w2-2)），实现细节见任务目录 `progress.md`。
- 2026-11-26 20:48 复跑整包 47f/548t 全绿；tsc 口径澄清：--verbose 双段输出致 grep 虚高，实际 57。
- 基线校准为独立 chore（`docs/project/tsc-baseline.json` 47→57），与本包代码改动分开提交。
- G7 真机验收待 nita 执行（30s tick 回流 / 15s 轮询抖动 / chip 闪烁 / GetAgentStatus 收口四项确认）。
