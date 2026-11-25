---
id: F-1122-overview-new-tab
title: "Overview 新建 Tab：工具栏 + 组尾入口 + 三选一弹窗"
type: feature
priority: P2
status: open
origin: self
source: "nita 2026-11-22：Overview 能否支持新增 Tab（ASCII 决策 C 两处入口）"
task: 11-22-overview-new-tab
order: 100
touch: [frontend/app/session-overview/overview-new-tab.ts, frontend/app/session-overview/overview-new-tab.test.ts, frontend/app/session-overview/overview-new-tab-modal.tsx, frontend/app/session-overview/session-overview.tsx, frontend/app/session-overview/session-overview.scss, frontend/i18n/locales/**, scripts/verify/overview-ux/**, scripts/verify/README.md, docs/project/verify-ledger.md, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 300, retries: 2}
releaseCandidate: false
createdAt: "2026-11-22T10:32:26Z"
feature: overview-board
---

# Overview 新建 Tab：工具栏 + 组尾入口 + 三选一弹窗

## 背景

_（待补）_

## 来源

- self：nita 2026-11-22：Overview 能否支持新增 Tab（ASCII 决策 C 两处入口）

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-new-tab.test.ts` → `5 passed`
- [ ] `npx vitest run frontend/app/session-overview` → `275 passed`
- [ ] `node scripts/verify/index.mjs --area overview-ux` → `15/15`
- [ ] `cmd /c "node scripts/i18n/check-parity.mjs >nul 2>&1 && echo PARITY_OK"` → `PARITY_OK`

_（待补）_

## 记录

_（待补）_
