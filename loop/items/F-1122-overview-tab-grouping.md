---
id: F-1122-overview-tab-grouping
title: "Overview Tab 分组 tab-first 化：组不消失 + 未打开灰行 + 批量取块骨架"
type: feature
priority: P1
status: open
origin: self
source: "nita 2026-11-22：Overview 里没打开过的 Tab 不显示（三叠加缺陷：空组被删 / 逐块串行拉取首帧空 / agentsOnly 删组）"
task: 11-22-overview-tab-grouping
order: 100
touch: [frontend/app/session-overview/overview-tab-groups.ts, frontend/app/session-overview/overview-tab-groups.test.ts, frontend/app/session-overview/session-overview.tsx, frontend/app/session-overview/session-overview-model.ts, frontend/app/session-overview/session-overview.scss, frontend/app/store/wos.ts, frontend/app/store/wos-prime.test.ts, frontend/i18n/locales/**, scripts/verify/overview-ux/**, scripts/verify/README.md, docs/project/verify-ledger.md, docs/project/ui-verify-playbook.md, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 360, retries: 2}
releaseCandidate: false
createdAt: "2026-11-22T06:39:17Z"
feature: overview-board
---

# Overview Tab 分组 tab-first 化：组不消失 + 未打开灰行 + 批量取块骨架

## 背景

_（待补）_

## 来源

- self：nita 2026-11-22：Overview 里没打开过的 Tab 不显示（三叠加缺陷：空组被删 / 逐块串行拉取首帧空 / agentsOnly 删组）

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-tab-groups.test.ts frontend/app/store/wos-prime.test.ts` → `11 passed`
- [ ] `npx vitest run frontend/app/session-overview` → `258 passed`
- [ ] `node scripts/verify/index.mjs --area overview-ux` → `10/10`
- [ ] `cmd /c "node scripts/i18n/check-parity.mjs >nul 2>&1 && echo PARITY_OK"` → `PARITY_OK`

## 记录

_（待补）_
