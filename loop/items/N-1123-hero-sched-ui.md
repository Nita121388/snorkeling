---
id: N-1123-hero-sched-ui
title: "Hero 定时执行前端：任务编辑弹窗 hero 选择器 + Overview 独立「定时任务」区"
type: feature
priority: P1
status: open
origin: self
source: "nita 2026-11-23 15:11 布置、当晚拍板：Overview 用独立定时任务展示区（不挂在 hero 卡上）"
task: 11-23-hero-sched-ui
order: 100
touch: [frontend/app/session-overview/**, frontend/app/modals/scheduledtaskeditormodal.tsx, frontend/i18n/locales/**, frontend/app/store/**, docs/project/**, loop/red/**, .trellis/**]
rollback: null
budget: {minutes: 240, retries: 2}
releaseCandidate: false
createdAt: "2026-11-23T11:17:09Z"
---

# Hero 定时执行前端：任务编辑弹窗 hero 选择器 + Overview 独立「定时任务」区

## 背景

前置= N-1123-hero-sched-core 已合并（ScheduledTaskType.Hero 字段与 hero home 语义）。锚点：frontend/app/modals/scheduledtaskeditormodal.tsx（378 行）· frontend/app/session-overview/overview-board.tsx + overview-tab-groups.ts · pkg/scheduler GetNextRunTime 口径 · hero roster 来源 frontend/app/workspace/hero-launch.ts

## 来源

- self：nita 2026-11-23 15:11 布置、当晚拍板：Overview 用独立定时任务展示区（不挂在 hero 卡上）

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview >/dev/null 2>&1 && echo VT_OVERVIEW_OK` → `VT_OVERVIEW_OK`
- [ ] `npx vitest run frontend/app/session-overview/overview-scheduled-tasks.test.ts >/dev/null 2>&1 && echo VT_SCHEDTASK_OK` → `VT_SCHEDTASK_OK`
- [ ] `npx vitest run frontend/app/modals >/dev/null 2>&1 && echo VT_MODALS_OK` → `VT_MODALS_OK`
- [ ] `npm run i18n:check >/dev/null 2>&1 && echo I18N_OK` → `I18N_OK`

## 记录

_（待补）_
