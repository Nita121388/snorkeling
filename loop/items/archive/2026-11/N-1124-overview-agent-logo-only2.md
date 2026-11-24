---
id: N-1124-overview-agent-logo-only2
title: "Overview 看板 Agent 卡 provider 只显品牌 logo（无 logo 回退文字）"
type: fix-small
priority: P2
severity: S3
status: open
origin: internal
source: "2026-11-24T06:19:17Z"
task: 11-24-overview-agent-logo-only
order: 100
touch: [frontend/app/session-overview/**, scripts/verify/overview-board/**, loop/red/**]
rollback: null
budget: {minutes: 45, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T06:19:17Z"
---

# Overview 看板 Agent 卡 provider 只显品牌 logo（无 logo 回退文字）

## 背景

_（待补）_

## 来源

- internal：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-board-provider-logo.test.tsx >/dev/null 2>&1 && echo VITEST_OK` → `VITEST_OK`
- [ ] `npx eslint frontend/app/session-overview/overview-board-provider-logo.test.tsx frontend/app/session-overview/overview-board.tsx >/dev/null 2>&1 && echo ESLINT_OK` → `ESLINT_OK`

## 记录

_（待补）_
