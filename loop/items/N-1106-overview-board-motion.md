---
id: N-1106-overview-board-motion
title: "Overview 看板卡片跨列移动动画（FLIP + WAAPI）"
type: feature
priority: P1
status: open
origin: self
source: "nita 2026-11-06 会话要求（先设计后开工）"
task: 11-06-overview-board-motion
order: 22
touch: [frontend/app/session-overview/**, scripts/verify/overview-board/**, docs/project/verify-ledger.md]
rollback: "纯前端；OVERVIEW_BOARD_MOTION_ENABLED=false 一行降级回瞬移，或 git revert 单次提交"
budget: {minutes: 90, retries: 1}
releaseCandidate: false
createdAt: "2026-11-06T01:05:49Z"
---

# Overview 看板卡片跨列移动动画（FLIP + WAAPI）

## 背景

_（待补）_

## 来源

- self：nita 2026-11-06 会话要求（先设计后开工）

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-board-motion.test.ts` → `10 passed`
- [ ] `npx vitest run frontend/app/session-overview/` → `70 passed`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `69`
- [ ] `node scripts/verify/overview-board/verify.mjs --expect=motion` → `exit 0`

## 记录

_（待补）_
