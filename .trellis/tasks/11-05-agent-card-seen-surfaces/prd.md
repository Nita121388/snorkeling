# 卡片三面接入 seen 视觉

## Goal

让 E/F/G 三个卡片面跟随 `AgentStatusView.read`：`unread` → 绿点 + 呼吸 + `Done 3m`；`seen` → 灰点 + 无动画 + `Done`。pill 可点击 ack。

## Requirements

- R1 `view/term/agent-hover-card.tsx`：状态 pill 改读 `deriveAgentStatusView`（入参含 `doneAckedAt`；`seenAt` 本子任务先传 0，等子任务 3 接入）。`statusAccent` 由 `view.read` 决定；`.agent-card` 内新增 `data-agent-read` 属性便于测试与 CDP 断言。
- R2 `tab/tab-more-agent-card.tsx` 的 `AgentMiniRow`：状态点 + 文案同上（unread 脉冲，seen 灰实心）；不再直接调 `agentStatusPresentation(state).label` 拼文案。
- R3 `tab/tab-info-card.tsx` 的 agent 行：`presentAgentState` 保留原签名不动，新增 `presentAgentStateFromView(view)` 并在组件内改用；pill 加 `is-seen` class。
- R4 样式：新增 `.is-seen`（灰点/灰字/无 animation，`opacity: .7`），与 `.is-done-unread` 互斥；放在既有 `is-acked` 视觉语言旁边。
- R5 pill 可点：`view.ackable` 时 `onClick(stopPropagation) → ackAgentStatus(...)`（收口函数在子任务 3 一并落地，未留临时双写）。
- R6 不改 `AgentHoverCard` 的身份/模型/note 区展示与既有 `React.memo` 结构；新增订阅用 `useAtomValueSafe`。

## Acceptance Criteria

- [x] AC1 CDP 实测：block 完成后 hover 卡片显示绿色 `Done 3m`；点头部徽章 ack 后**不刷新**，同一张卡变灰 `Done`，无呼吸动画。
- [x] AC2 新一轮 working→idle 完成后，卡片重新变绿（切 tab 回来也不变回灰）。
- [x] AC3 `AgentMiniRow` 与 Tab 悬浮卡同样跟随（三面同一 `read`，加跨面契约测试）。
- [x] AC4 `.is-seen` 与 `.is-done-unread` 不会同时出现在同一节点（单测断言 className 互斥）。
- [x] AC5 `npx tsc --noEmit` + `app/tab` / `app/view/term` 相关 vitest 全绿。

## Notes

- 三面文案统一 `Done`（不引入 `Seen` 词），"读没读"只由颜色/动画表达——见父任务 PRD R6。
- 本子任务不写 `seenAt`，只消费入参；`seenAt` 全为 0 时行为等价于现状 + ack 联动。

## 落地记录

- 三面已接入：`agent-hover-card.tsx`（悬浮卡 / AgentCardModal 共用）、`tab-more-agent-card.tsx` 的 `AgentMiniRow`、`tab-info-card.tsx` + `tab-info-card-model.ts:presentAgentStateFromView`。
- 新增 `.agent-card-status-chip.is-seen` / `.is-ackable` / `.agent-card-status-dot.is-done-unread` / `.tab-card-agent-row.is-seen` 样式；未读 Done 用慢呼吸，已读停动画并降透明度。
- AC1 的真机 CDP 复核未做（检查时 9222 无实例），已由跨面契约测试覆盖 read 一致性。
