# Implement：看板卡「恢复」+ composer 浮层

## 0. 红证

`frontend/app/session-overview/overview-board-card-actions.test.ts`：`boardCardCapabilities` 四组矩阵
（非 agent / agent 无 session / agent 有 session / 空 blockId）。红 = 模块不存在。

## 1. 纯函数 `overview-board-card-actions.ts`

按 design §2。判定：单测绿。

## 2. 抽 `CardSendPanel`

- 把 `session-overview.tsx` 里行内 composer 的 JSX + 发送/重试/继续等逻辑整段搬到
  `overview-card-send-panel.tsx`（`variant` 只切根类名与定位），列表侧改为
  `<CardSendPanel variant="inline" .../>`。
- 行为零变化：Enter 发送 / Shift+Enter 换行 / Esc 收起 / 行程徽章 / 失败重试 /
  `E_AGENT_NOT_READY → 改为不等待` / 超时 → `继续等`（`SessionWaitCommand`）。
- 判定：`npx vitest run frontend/app/session-overview` 全绿（275 现有 + 新增）。

## 3. 看板卡动作

- `overview-board.tsx`：卡动作区按 `boardCardCapabilities(card)` 渲染两枚按钮；
  `onResumeCard` / `onOpenSendPanel` 由上层传入（props 引稳，`useCallback`）。
- 浮层：`variant="popover"` + FloatingPortal，面板级单一 state（`sendPanelBlockId`）。
- 恢复：`AgentResumeCommand`（design §3 参数）；成功 bump `refreshSeqAtom`；失败内联错误。
- 判定：`npm run build:dev` 过；tsc 无新增；i18n parity 0。

## 4. 手动 + 自动验证

- 用户手动：看板卡点「恢复」→ 新块出现且卡片变活卡；点「发消息」→ 浮层发出 `CARD_OK` 收到回复。
- 自动：`node scripts/verify/overview-board/verify.mjs` 不退化（79/79）。

## 出界即停

touch：`frontend/app/session-overview/overview-board-card-actions.{ts,test.ts}`、
`overview-card-send-panel.tsx`、`overview-board.tsx`、`session-overview.tsx`、`session-overview.scss`、
`frontend/i18n/locales/**`、`.trellis/spec/**`、`loop/**`。
改后端 / `overview-card-send.ts` 的纯函数语义 = 停，报告。
