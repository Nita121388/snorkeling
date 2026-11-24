# PRD：看板 agent 卡与列表融合（会话方块 + 去恢复 icon）

> 父任务 `11-24-overview-agent-batch`。需求 R1/R2，方案 `../11-24-overview-agent-batch/design.md` §2，步骤 `implement.md` P1/P2。

## Goal

1. 看板 agent 卡显示与列表**同款**「会话方块」消息条（可点击打开消息、超限 `+n`），且与列表**共用同一份渲染实现**；
2. 看板 agent 卡**不再显示恢复 icon**，配套死代码一并清除。

## R1 会话方块

- 现状：卡片只有一行 `preview` 文本（`overview-board.tsx` body）；列表有 `MessageSquares`（`session-overview.tsx:1257`）。
- 做法：抽 `session-message-squares.tsx` 共用组件；`OverviewBoardCard` 增 `recentMessages` / `messagesOverflow`（数据侧已算出 `messages`，零额外请求）；上限常量 10。
- 约束：只在 agent 卡且有会话时渲染；卡高不随消息数跳动；点击方块 `stopPropagation` 并打开该消息；无消息不渲染空行。

## R2 移除恢复 icon

- 删除：`overview-board.tsx` 的 `onResumeCard` / `BoardCardResumeOutcome` / `showRestore` / `runRestore` / `restoring` / `restoreError` / `data-board-restore` / `data-board-restore-error`；`session-overview.tsx` 的 `handleResumeBoardCard` 及传参；`overview-board-card-actions.ts` 的 `canRestore`；三处 i18n key（zh/en）。
- 保留：`AgentResumeCommand` RPC、AISessions「恢复到终端」入口。

## 验收判据

```bash
npx vitest run frontend/app/session-overview/overview-board-message-squares.test.tsx && echo FUSE_SQUARES_OK
```
→ `FUSE_SQUARES_OK`

```bash
npx vitest run frontend/app/session-overview/overview-board-card-actions.test.ts && echo FUSE_ACTIONS_OK
```
→ `FUSE_ACTIONS_OK`

```bash
npx vitest run frontend/app/session-overview && echo FUSE_ALL_OK
```
→ `FUSE_ALL_OK`

单测覆盖：方块数量/`+n`/点击回传 seq/无消息不渲染/`[data-board-restore]` 为 0 个/能力位不含 canRestore。

## 非目标

不做 `SessionCard` 整体组件合并（独立包 `11-23-session-card-unify`）。
