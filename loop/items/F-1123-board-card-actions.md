---
id: F-1123-board-card-actions
title: "看板卡补齐能力：恢复 agent + composer 浮层发送（复用 AgentResumeCommand / card-send）"
type: feature
priority: P1
status: open
origin: self
source: "nita 2026-11-23：看板卡也要能恢复 agent、能就地发消息（列表行已有）；拍板 D1=A（按会话恢复到所在 Tab）+ D2=浮层面板"
task: 11-23-board-card-actions
order: 100
touch: [frontend/app/session-overview/overview-board-card-actions.ts, frontend/app/session-overview/overview-board-card-actions.test.ts, frontend/app/session-overview/overview-card-send-panel.tsx, frontend/app/session-overview/overview-board.tsx, frontend/app/session-overview/session-overview.tsx, frontend/app/session-overview/session-overview.scss, frontend/i18n/locales/**, docs/project/verify-ledger.md, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 600, retries: 2}
releaseCandidate: false
createdAt: "2026-11-23T05:35:25Z"
---

# 看板卡补齐能力：恢复 agent + composer 浮层发送（复用 AgentResumeCommand / card-send）

## 背景

_（待补）_

## 来源

- self：nita 2026-11-23：看板卡也要能恢复 agent、能就地发消息（列表行已有）；拍板 D1=A（按会话恢复到所在 Tab）+ D2=浮层面板

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-board-card-actions.test.ts` → `4 passed`
- [ ] `npx vitest run frontend/app/session-overview` → `279 passed`
- [ ] `npm run build:dev` → `built in`
- [ ] `powershell -NoProfile -Command "if (Select-String -Path docs/project/verify-ledger.md -Pattern board-card-actions -Quiet) { echo LEDGER_OK }"` → `LEDGER_OK`

## 记录

_（待补）_
