---
id: N-1124-overview-agent-fuse
title: "看板 agent 卡与列表融合：会话方块条共用组件 + 移除恢复 icon"
type: fix-small
priority: P2
severity: S2
status: open
origin: internal
source: "2026-11-24T08:46:02Z"
task: 11-24-overview-agent-card-fuse
order: 100
touch: [frontend/app/session-overview/**, frontend/i18n/locales/**, scripts/verify/overview-board/**, docs/project/**, .trellis/**, loop/**]
rollback: null
budget: {minutes: 150, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T08:46:02Z"
feature: overview-board
---

# 看板 agent 卡与列表融合：会话方块条共用组件 + 移除恢复 icon

## 背景

用户 2026-11-24 反馈：agent card 没有显示列表中那种会话方块；agent card 上无须显示恢复 icon。现状：看板卡只有一行 preview 文本，列表有 MessageSquares（session-overview.tsx:1257）；恢复按钮在 overview-board.tsx:419 并带整套状态/内联报错。做法：抽 session-message-squares.tsx 共用组件（列表视觉零变化是红线），OverviewBoardCard 增 recentMessages/messagesOverflow（上限 10）；恢复按钮、onResumeCard、BoardCardResumeOutcome、runRestore、restoreError、canRestore、handleResumeBoardCard 与三处 i18n 一并删除。保留 AgentResumeCommand RPC 与 AISessions 恢复到终端入口。

## 来源

- internal：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-board-message-squares.test.tsx && echo N1124_SQUARES_OK` → `N1124_SQUARES_OK`
- [ ] `npx vitest run frontend/app/session-overview/overview-board-card-actions.test.ts && echo N1124_ACTIONS_OK` → `N1124_ACTIONS_OK`
- [ ] `npx eslint frontend/app/session-overview && echo N1124_FUSE_LINT_OK` → `N1124_FUSE_LINT_OK`

## 记录

_（待补）_
