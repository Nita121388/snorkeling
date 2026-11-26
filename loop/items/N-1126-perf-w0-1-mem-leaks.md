---
id: N-1126-perf-w0-1-mem-leaks
title: "Wave 0-1: 修 TermWrap 销毁定时器泄漏、emain Tab 缓存 LRU 比较器与离屏 setBounds 短路"
type: bug
priority: P0
severity: S2
status: open
origin: self
source: "2026-11-26T04:55:18Z"
task: 11-26-perf-w0-1-mem-leaks
order: 100
touch: [frontend/app/view/term/termwrap.ts, frontend/app/view/term/termwrap-dispose-leak.test.ts, emain/emain-tabview.ts, emain/emain-tabview-cache.test.ts]
rollback: null
budget: {minutes: 30}
releaseCandidate: false
createdAt: "2026-11-26T04:55:18Z"
---

# Wave 0-1: 修 TermWrap 销毁定时器泄漏、emain Tab 缓存 LRU 比较器与离屏 setBounds 短路

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/view/term/termwrap-dispose-leak.test.ts && echo W0_1_TERMWRAP_OK` → `W0_1_TERMWRAP_OK`
- [ ] `npx vitest run emain/emain-tabview-cache.test.ts && echo W0_1_TABVIEW_OK` → `W0_1_TABVIEW_OK`

## 记录

_（待补）_
