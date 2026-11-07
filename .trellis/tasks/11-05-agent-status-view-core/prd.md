# AgentStatusView 纯函数与 read 判定

## Goal

新增 `frontend/app/agent-status/agent-status-view.ts`，提供 `deriveAgentStatusView` + `resolveAgentSeenAt`，配表驱动单测。**本子任务零 UI 变更**，不改任何现有消费者。

## Requirements

- R1 新增类型 `AgentReadState` / `AgentStatusView`，字段见父任务 `design.md §2`。
- R2 `resolveAgentSeenAt({doneAckedAt, seenAt})` = `max`，非有限值/负数当 0。
- R3 `deriveAgentStatusView` 复用既有函数，不复制判定逻辑：
  - `agentStatusPresentation` → label / title / icon
  - `isInferredAgentStatus`
  - `isAgentStatusUnread(status, ackedFp)` → R 类
  - `isAgentDoneUnread(status, resolveAgentSeenAt(...))` → D 类
  - `agentDoneElapsedMs` + `formatDoneElapsed` → `elapsedText`
  - `read = (unread || doneUnread) ? "unread" : "seen"`
- R4 `status == null` → 返回 `null`（消费面自行决定不渲染）。
- R5 `ackable = read === "unread"`（done 与 R 类都可 ack；idle/unknown 恒 false）。
- R6 `tone` 从 `state` 映射（done→done、working→working …），供样式类使用。
- R7 不修改 `agent-status-derive.ts` 任何导出函数的签名或行为。

## Acceptance Criteria

- [x] AC1 表驱动单测：R 类 fp 不匹配/匹配、done 未 seen/已 seen、idle 无跳变、未知 provider、null status，全部覆盖。
- [x] AC2 边界：`seenAt` > `doneAckedAt` 时视为 seen；二者都为 0 时 done 为 unread。
- [x] AC3 `agent-status-derive.test.ts` / `agent-status-done-unread.test.ts` / `agent-status-done-ack-store.test.ts` 全绿且**未改动**。
- [x] AC4 新增文件通过 `npx tsc --noEmit`。

## Notes

- 纯函数放 `agent-status/` 与既有模块同层，命名 `agent-status-view.ts` / `agent-status-view.test.ts`。
- 不在本子任务引入 `seenAt` store（那是子任务 3），入参就是普通 number。

## 落地记录（与初稿差异）

- `resolveAgentSeenAt` / 独立 `seenAt` 入参在实现中取消（见父任务 design.md §3 的落地调整）：已读只有一条 `doneAckedAt` 通道。
- 新增 `promoteCompletedIdle()`：吃 canonical 的 `idle + prevState` 输入时也给出 `state:"done"`，避免 HeaderElem 工厂 / 单测拿到 canonical 输入时结论和 presented 输入不一致。
- 新增 `agentStatusAccent()` / `agentStatusViewLabel()` / `isAgentDoneAwaitingView()` 三个纯函数供展示面共用。
