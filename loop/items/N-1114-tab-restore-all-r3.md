---
id: N-1114-tab-restore-all-r3
title: "重启后 Tab 栏只恢复激活一个 Tab，其余全被藏进「更多」"
type: bug
priority: P1
status: open
origin: self
source: "nita 2026-11-14 会话：重启后应默认恢复上次打开的全部 Tab（Trellis 10-26-tab-startup-restore 片 0）；前包 r1/r2 因真机台判据与 expect 措辞问题被丢弃重建"
task: 10-26-tab-startup-restore
order: 100
touch: [emain/emain-window.ts, emain/emain-window.test.ts, scripts/verify/tab-startup-restore/, scripts/verify/README.md, docs/project/verify-ledger.md]
rollback: null
budget: {minutes: 60, retries: 1}
releaseCandidate: false
createdAt: "2026-11-14T06:54:08Z"
---

# 重启后 Tab 栏只恢复激活一个 Tab，其余全被藏进「更多」

## 背景

_（待补）_

## 来源

- self：nita 2026-11-14 会话：重启后应默认恢复上次打开的全部 Tab（Trellis 10-26-tab-startup-restore 片 0）；前包 r1/r2 因真机台判据与 expect 措辞问题被丢弃重建

## 验收判据

- [ ] `npx vitest run emain/emain-window.test.ts` → `4 passed`
- [ ] `node scripts/check-tsc-baseline.mjs` → `47 = 基线`

## 记录

_（待补）_
