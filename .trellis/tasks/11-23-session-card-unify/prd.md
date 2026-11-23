# PRD：列表卡与看板卡融合成单一 SessionCard

> 父：`11-23-session-surface-fixes-1123`（优先级序 5，M-L）。**依赖 `11-23-board-card-actions` 先落地。**

## Goal

一张会话卡只有一份实现，列表（`variant="row"`）与看板（`variant="card"`）只是尺寸与展开方式不同；
新能力只写一次，两视图自动都有。

## 需求

- R1 抽 `SessionCard`（`frontend/app/session-overview/session-card.tsx`）：
  props = `{ card: OverviewSessionCard, variant: "row" | "card", expanded, onExpand, actions }`。
- R2 统一数据模型 `OverviewSessionCard`（由现有 `OverviewBoardCard` 收口；列表行不再单独拼）。
- R3 共用部分：头像/persona、标题、状态 chip、provider、age、属性行、tags、actions（恢复/跳转/备注/删除）、
  composer（row 内联展开；card 浮层）。
- R4 视觉等价：列表与看板各自现有 CSS 类保留（`variant` 只决定根类名），不做视觉重设计。

## 验收判据（数字）

- 单测：同一 fixture 在 `variant=row` / `variant=card` 渲染出的 counts / chips / actions 数逐一相等。
- 像素回归：`scripts/verify/overview-board` 79/79 不退化；`overview-ux` 15/15 不退化。
- 代码面：删除旧的重复实现后，`session-overview.tsx` 行渲染与 `overview-board.tsx` 卡渲染的
  重复 props 映射为 0 处（人工核对 + 行数下降）。

## 不做

- 不改数据源 / RPC；不改看板分组维度。
