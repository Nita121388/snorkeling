# Overview 看板会话卡体验四项：方块条下移 / 详情弹窗去删除 / 详情卡补内容 / 属性行间距字号

## Goal

修掉 overview 看板 agent 会话卡的四处体验问题：信息顺序（方块条压在内容之上）、详情弹窗误删、详情卡信息量缩水、属性行零间距且字号低于可读下限。

## Requirements

### R1 布局：会话方块条移到会话内容之下

看板卡（`frontend/app/session-overview/overview-board.tsx` 的 `BoardCard`）当前纵向顺序：

`card-head`（头像/标题/动作）→ `card-squares`（`SessionMessageSquares`）→ `card-meta`（状态胶囊/provider/project/标签）→ `card-preview`（会话内容预览）→ `card-note` → `card-data`（度量+迷你时间线）。

期望顺序：`card-head` → `card-meta` → `card-preview` → **`card-squares`** → `card-note` → `card-data`。

即方块条渲染在内容预览**之后**、备注/度量之前。渲染条件（`isAgentLike && sessionId !== "" && recentMessages.length > 0`）与点击语义（打开该条消息、不冒泡成整卡点击）保持不变。

### R2 消息详情弹窗移除「删除块」按钮

`frontend/app/session-overview/session-overview.tsx` 的 `MessageDialog`：删除底部备注行里的「删除块」按钮（`.session-overview-block-x-button`，`onDeleteBlock`），连同 `MessageDialogProps.onDeleteBlock` 与调用点传入的 `onDeleteBlock` 实现整条链路移除。

理由：与右上角关闭同为 xmark 图标、且是不可逆删除，读一条消息时误触即把卡从看板移除；删除入口在看板卡动作区/列表行本就有。

保留：`onEditSessionNote`、跳转、「message body」等其余内容不变。三个入口（看板方块 / 列表方块 / 「看全文」）共用该弹窗，统一生效。

### R3 详情卡片补齐看板卡信息（放大不降级）

点 agent 卡打开的 `AgentCardModal`（`frontend/app/modals/agentcardmodal.tsx`，内部 `AgentHoverCard`）目前只有身份/模型/状态/星标、标题、note+tags，少于看板卡本身。

期望补充（按看板卡同一份实现，不复制 JSX）：

1. **会话方块条**：复用 `SessionMessageSquares`，数据来自该 session 的最近消息（与看板同一份 `readableMessages` + `messagePreview` + 上限裁剪管线）。
2. **度量轨**：复用 `SessionMetrics`，数据取 `useSessionNoteState` 的 `summary`（`messageCount` / `size` / `createdAt` / `updatedAt` / `live`）。

方块点击语义：打开该会话详情（`AISessionDetailModal`），与弹窗 footer 的「打开会话详情」一致。

显式不做（记入 Notes）：迷你时间线（`OverviewTimelineSegment` 只由看板 model 计算，弹窗侧没有时间线数据源；本包不为此新增数据管线）。

### R4 属性行：补间距 + 字号提升到可读档

`frontend/app/session-overview/session-overview.scss`：

- `.session-overview-board-card-props` 当前无纵向间距，与下方 `.session-overview-board-card-preview` 贴死 → 补 `margin-bottom: 8px`（design-system §6 间距 token）。
- `.session-overview-board-card-prop` 10px → 11px；`.session-overview-board-card-prop .property-chip` 9px/16px 高 → 10px/18px 高；`.session-overview-board-card-prop-more` 9px → 10px。

依据：`project-docs/design-system.md` §5 —— micro status 徽章下限 10px、密集元数据 12px；现状 9px 胶囊低于下限。

## Constraints

- 共用组件优先：方块条与度量轨必须复用 `SessionMessageSquares` / `SessionMetrics`，禁止复制 JSX（历史上复制导致的视觉/交互漂移已复现多次）。
- 不动后端、不动 session 存储格式；纯前端渲染与样式。
- 卡高不因消息数/标签数/属性数变化而跳动（沿用现有裁断规则）。
- 现有 DOM 契约不能破：`data-board-message-square`、`data-board-meta`、`data-board-prop-type`、`data-board-tag` 等 verify 探针锚点保持存在。
- 设计系统字号下限：不新增 <10px 的文本节点。

## Acceptance Criteria

- [ ] R1：`npx vitest run frontend/app/session-overview/overview-board-message-squares.test.tsx` 通过；新增/更新单测断言在卡片内 DOM 顺序中 `card-preview` 索引 < `card-squares` 索引。
- [ ] R2：`rg -n "onDeleteBlock" frontend/app/session-overview/session-overview.tsx` 在 `MessageDialog` 相关代码段无命中；`npx vitest run frontend/app/session-overview` 全绿；弹窗中 `.session-overview-block-x-button` 计数为 0（单测或 verify 探针）。
- [ ] R3：`npx vitest run frontend/app/modals frontend/app/session-overview` 全绿；`AgentCardModal` 打开的弹窗 DOM 内 `.session-overview-message-square` ≥ 1（有历史消息时）且 `.session-metrics` 存在；无消息时不留空行。
- [ ] R4：`node scripts/verify/index.mjs` 新增断言：卡内 `.session-overview-board-card-props` 的 `margin-bottom` 为 8px，`.property-chip` 计算字号 ≥10px；或 scss 单测/样式契约测试等价覆盖。
- [ ] 真机验证：`node scripts/verify/overview-board/verify.mjs` 全绿（含新增断言），台账追加一行到 `docs/project/verify-ledger.md`。
- [ ] 无 lint/type 回归：`npx tsc --noEmit`（或仓库既定 typecheck 命令）通过。

## Notes

- R3 的方块数据：优先读 `getCachedSessionDetail`，缺失时用 `loadCachedSessionDetail(service, sessionId, { tail: 100 })` 拉取，与看板 detail 同一缓存与管线。
- R3 迷你时间线明确跳过（无数据源，需另开包）。
- 弹窗内方块点击 → `modalsModel.pushModal("AISessionDetailModal", …)`（复用现成层级，不新增弹窗）。
