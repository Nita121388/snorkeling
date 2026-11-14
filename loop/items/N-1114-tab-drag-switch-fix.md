---
id: N-1114-tab-drag-switch-fix
title: "Tab 栏交互修复：点击误判拖拽换位 + 切换高亮迟滞 + 广播重复入队"
type: bug
priority: P1
status: open
origin: self
source: "nita 2026-11-14 会话反馈：点击 Tab 迟迟切换/被误识别为拖拽移动位置（修了多次仍有）/切换略显卡顿；确认方案=拖拽全套 + 切换乐观高亮 + 双入队去重（R8/R9）"
task: 10-26-tab-startup-restore
order: 100
touch: [frontend/app/tab/tab-drag-model.ts, frontend/app/tab/tab-drag-model.test.ts, frontend/app/tab/tab-optimistic-active.ts, frontend/app/tab/tab-optimistic-active.test.ts, frontend/app/tab/tabbar.tsx, frontend/app/tab/vtabbar.tsx, emain/emain-window.ts, emain/emain-window.test.ts, emain/emain.ts, .trellis/tasks/10-26-tab-startup-restore/]
rollback: null
budget: {minutes: 90, retries: 1}
releaseCandidate: false
createdAt: "2026-11-14T07:05:22Z"
---

# Tab 栏交互修复：点击误判拖拽换位 + 切换高亮迟滞 + 广播重复入队

## 背景

_（待补）_

## 来源

- self：nita 2026-11-14 会话反馈：点击 Tab 迟迟切换/被误识别为拖拽移动位置（修了多次仍有）/切换略显卡顿；确认方案=拖拽全套 + 切换乐观高亮 + 双入队去重（R8/R9）

## 验收判据

- [ ] `npx vitest run frontend/app/tab/tab-drag-model.test.ts frontend/app/tab/tab-optimistic-active.test.ts emain/emain-window.test.ts` → `21 passed`
- [ ] `node scripts/check-tsc-baseline.mjs` → `47 = 基线`

## 记录

_（待补）_
