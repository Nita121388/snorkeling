---
id: F-1117-overview-card-props
title: "Overview agent 卡面显示 Note/Tags/自定义属性（含状态）"
type: feature
priority: P1
status: open
origin: internal
source: "2026-11-17T07:43:27Z"
task: 11-17-overview-agent-card-props
order: 100
touch: [frontend/app/session-overview/overview-board-model.ts, frontend/app/session-overview/overview-board-model.test.ts, frontend/app/session-overview/overview-board.tsx, frontend/app/session-overview/overview-board-memo.test.tsx, frontend/app/session-overview/session-overview.tsx, frontend/app/session-overview/session-overview.scss, frontend/app/element/info-card/session-note-section.tsx, frontend/i18n/locales/en/session-overview.json, frontend/i18n/locales/zh/session-overview.json, frontend/i18n/locales/en/element.json, frontend/i18n/locales/zh/element.json, scripts/verify/overview-board/**, scripts/verify/README.md, docs/project/verify-ledger.md, .trellis/tasks/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 90, retries: 1}
releaseCandidate: false
createdAt: "2026-11-17T07:43:27Z"
---

# Overview agent 卡面显示 Note/Tags/自定义属性（含状态）

## 背景

_（待补）_

## 来源

- internal：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-board-model.test.ts` → `passed`
- [ ] `npx vitest run frontend/app/session-overview frontend/app/element/info-card --reporter=basic` → `passed`
- [ ] `npm run i18n:check` → `i18n ok`
- [ ] `node --check scripts/verify/overview-board/verify.mjs` → `0`

## 记录

_（待补）_
