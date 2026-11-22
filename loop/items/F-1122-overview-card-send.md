---
id: F-1122-overview-card-send
title: "Overview 列表卡展开 + composer 发送（派发/等回复/失败原地重试）"
type: feature
priority: P1
status: open
origin: self
source: "nita 2026-11-22：Overview agent 卡点击后要能编辑信息并发送（复用 11-21 派发队列 + 等回复）"
task: 11-22-overview-card-send
order: 100
touch: [frontend/app/session-overview/overview-card-send.ts, frontend/app/session-overview/overview-card-send.test.ts, frontend/app/session-overview/session-overview.tsx, frontend/app/session-overview/session-overview.scss, frontend/i18n/locales/**, scripts/verify/overview-ux/**, scripts/verify/README.md, docs/project/verify-ledger.md, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 420, retries: 2}
releaseCandidate: false
createdAt: "2026-11-22T09:53:21Z"
---

# Overview 列表卡展开 + composer 发送（派发/等回复/失败原地重试）

## 背景

_（待补）_

## 来源

- self：nita 2026-11-22：Overview agent 卡点击后要能编辑信息并发送（复用 11-21 派发队列 + 等回复）

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-card-send.test.ts` → `12 passed`
- [ ] `npx vitest run frontend/app/session-overview` → `275 passed`
- [ ] `node scripts/verify/index.mjs --area overview-ux` → `15/15`
- [ ] `cmd /c "node scripts/i18n/check-parity.mjs >nul 2>&1 && echo PARITY_OK"` → `PARITY_OK`

_（待补）_

## 记录

_（待补）_
