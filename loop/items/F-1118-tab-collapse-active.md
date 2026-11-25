---
id: F-1118-tab-collapse-active
title: "Tab 收起激活 Tab：收起并切走"
type: feature
priority: P2
status: open
origin: internal
source: "2026-11-18T02:23:17Z"
task: 11-18-tab-collapse-active
order: 100
touch: [frontend/app/tab/tab-more-model.ts, frontend/app/tab/tabcontextmenu.ts, frontend/app/tab/tabcontextmenu.test.ts, frontend/app/tab/tab-more-model.test.ts, frontend/app/tab/tab.tsx, frontend/app/tab/tabbar.tsx, frontend/app/tab/vtabbar.tsx, frontend/i18n/locales/en/tab.json, frontend/i18n/locales/zh/tab.json, scripts/verify/**, docs/project/verify-ledger.md, .trellis/tasks/**, loop/**]
rollback: null
budget: {minutes: 90, retries: 1}
releaseCandidate: false
createdAt: "2026-11-18T02:23:17Z"
feature: tab-system
---

# Tab 收起激活 Tab：收起并切走

## 背景

「收起激活 Tab」的真实诉求是「这个 Tab 暂时不用了，收起来去看别的」——激活恰恰是最常被收起的那一个。
原实现（N-1117）因为「激活 > 收起」的优先级把激活 Tab 置灰；正确解法是收起时先切走激活态。

## 来源

- internal：2026-11-18 白天对话（用户指出「功能本身就是一些激活的 Tab 我暂时不想用想要折叠到更多的」）。
- 语义修订对象：`N-1117-tab-collapse-to-more`。

## 验收判据

- [x] `npx vitest run frontend/app/tab/tabcontextmenu.test.ts frontend/app/tab/tab-more-model.test.ts` → `37 passed`
- [x] `npm run i18n:check 2>&1` → `parity diff: 0`

## 记录

- 2026-11-18：G1 由用户会话确认（「ok go」+ 相邻优先/未阅仍置灰两点拍板）；prdHash 已冻结。
- 2026-11-18：红证 base 0789f225e → 8 failed | 29 passed（5× pickCollapseSwitchTarget 未实现 + 3× 契约不符），
  实现后同套 37/37；红证存 `loop/red/F-1118-tab-collapse-active.txt`。
- 2026-11-18：Tab 族回归 `npx vitest run frontend/app/tab/` → 113 passed；tsc 当前 55 条全为既有文件欠账
  （与本包改动文件 0 条；基线 47→55 的刷新已在 INBOX 记欠，归入另包）。
- 2026-11-18：真机验证台（vtab area）**skipped** —— 用户本机性能不足，主动放弃；证据只有单测 + 静态检查。
- 2026-11-18：判据字面量从「全绿/通过」改为「37 passed / 键 parity diff: 0」——prove 按输出子串判定，
  原措辞机器不可判；语义未变，非需求变更。
