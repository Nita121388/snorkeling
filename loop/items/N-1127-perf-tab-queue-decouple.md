---
id: N-1127-perf-tab-queue-decouple
title: "冷切 Tab 队列解耦：先锁 6 项竞态单测，再开 action-queue / wave-ready 解耦开关（可回滚）"
type: bug
priority: P2
severity: S2
status: open
origin: self
source: "HANDOFF.md 遗留 follow-up 4 + .trellis/tasks/11-19-tab-switch-queue-decouple/prd.md"
task: 11-19-tab-switch-queue-decouple
order: 100
touch: [emain/emain-window.ts, emain/emain-tabview.ts]
rollback: null
budget: {minutes: 120}
releaseCandidate: false
createdAt: "2026-11-27T01:25:18Z"
---

# 冷切 Tab 队列解耦：先锁 6 项竞态单测，再开 action-queue / wave-ready 解耦开关（可回滚）

## 背景

_（待补）_

## 来源

- self：HANDOFF.md 遗留 follow-up 4 + .trellis/tasks/11-19-tab-switch-queue-decouple/prd.md

## 验收判据

- [ ] `npx vitest run frontend/app/tab && echo TAB_QUEUE_OK` → `TAB_QUEUE_OK`

## 记录

_（待补）_
