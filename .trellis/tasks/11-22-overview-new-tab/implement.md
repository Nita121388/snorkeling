# Implement：Overview 新建 Tab

## 0. 红证

`frontend/app/session-overview/overview-new-tab.test.ts`：`planNewTab` ≥5 用例
（empty/agent/template 拒绝/空名回落/trim）。红 → 登记 `loop/red/F-1122-overview-new-tab.txt`。

## 1. 纯函数 `overview-new-tab.ts`

判定：`npx vitest run frontend/app/session-overview/overview-new-tab.test.ts` → 绿

## 2. 弹窗 `overview-new-tab-modal.tsx`（DialogShell 复用）

键盘 Esc/Enter；失败原地 `⚠` + 重试；创建链 `CreateTab(…, false)` →（agent 时）`CreateBlockInTab(…, false, false)`。

## 3. 两处入口 + i18n + 样式

工具栏一枚 + 组列表尾部一行（`data-overview-new-tab`）。i18n 中英同步。
判定：`npx vitest run frontend/app/session-overview` 全绿；`node scripts/i18n/check-parity.mjs` → diff 0；`npm run build:dev` 过。

## 4. 真机（overview-ux 加第 14-15 条）

14. 工具栏入口 → 空 Tab：`workspace.tabids` +1、组头数 +1、当前激活 Tab 不变。
15. 组尾入口 → 空 Tab + Agent：新 Tab 的 `blockids` = 1 且块 meta 含 `agent:*`；不抢焦点。

判定：`node scripts/verify/overview-ux/verify.mjs` → 15/15

## 出界即停

touch：`frontend/app/session-overview/overview-new-tab.{ts,test.ts}`、`overview-new-tab-modal.tsx`、
`session-overview.tsx`、`session-overview.scss`、`frontend/i18n/locales/**`、
`scripts/verify/overview-ux/**`、`scripts/verify/README.md`、`docs/project/verify-ledger.md`、
`.trellis/spec/**`、`loop/**`。
