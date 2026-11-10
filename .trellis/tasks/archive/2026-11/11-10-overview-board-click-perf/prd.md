# Overview 看板点击卡片开弹窗卡顿：消除整板重渲

## Goal

点击 Overview 看板 agent 卡片打开 `AgentCardModal` 时，弹窗入场（`modalScaleIn`，200ms）首帧被长任务压住，观感为「点了一下顿一下才弹出来」。消除点击路径上不必要的全量重渲染，不改变任何功能语义。

## 根因（代码级归因，2026-11-10 会话）

一次 card click 事件里同步发生三件事，被 React 18 批成同一 commit：

1. `session-overview.tsx` `onOpenCard` 内 `setSelectedBlockId(card.blockId)`（看板分支无消费方，纯浪费的面板重渲）
2. `markBlockViewed` → `globalStore.set(blockViewedAtAtom, {...map})`（整 map 新引用，`SessionOverviewPanel` 订阅了它）
3. `modalsModel.pushModal("AgentCardModal")`（弹窗挂载，本批 commit 的正向收益）

而这次 commit 的主体是**整块看板全量重渲**：`overview-board.tsx` 的 `BoardCard` 无 `React.memo`；父级 `onOpenCard/onJumpCard/onCloseCard/onDeleteSession` 全是内联箭头函数（每次渲染新引用），即便加 memo 也全部失效。卡片上百张时是几十 ms 级 long task，弹窗 scale-in 动画起手掉帧。

## Requirements

- R1 `BoardCard` 用 `React.memo` 包裹（`overview-board.tsx`）。
- R2 `SessionOverviewPanel` 里传给 `OverviewBoard` 的 4 个内联回调（`onOpenCard/onJumpCard/onCloseCard/onDeleteSession`）改为 `React.useCallback`，引用稳定。
- R3 看板「agent-like 卡片开弹窗」分支不再调用 `setSelectedBlockId`（该状态仅被列表视图的 `highlightedBlockId` 消费）；`markBlockViewed` 保留（功能性）。
- R4 卡片点击命中开弹窗时 `event.stopPropagation()`，不再冒泡到 block frame 触发 `setBlockClickedTrue` → `setFocusTarget/focusNode` 焦点搬运那一轮额外渲染。键盘 Enter/Space 路径保持不变。
- 约束：本次不做真机验证（用户明确豁免）；不改 `markBlockViewed` 的持久化行为、不动弹窗动画 CSS。

## Acceptance Criteria

- [ ] `npx vitest run frontend/app/session-overview --reporter=dot` 全绿（含 overview-board/board-jump/board-motion/board-empty-label 等既有用例不回归）。
- [ ] 新增用例：`overview-board.test.tsx` —— 父组件无关 state 变化（如 `now` tick）时 `BoardCard` 不重渲（memo 生效）；点击卡片后 `onOpenCard` 正常触发。
- [ ] `python -c "..."` 静态断言：`session-overview.tsx` 中 `OverviewBoard` 的 4 个回调均为 `useCallback` 产物（`onOpenCard={handleOpenBoardCard}` 形式），`overview-board.tsx` 中 `BoardCard` 为 `React.memo` 包裹。
- [ ] `npx tsc --noEmit` 错误数不高于当前基线（≤ 47）。

## Notes

- 用户已确认不需要真机验证（verify 台免跑）。
- 后续可选（不在本包内）：`modalsrenderer.tsx` `modalOpen` 二段渲染、`.modal` `will-change: transform`、`writeViewedAt` 延迟写盘。
