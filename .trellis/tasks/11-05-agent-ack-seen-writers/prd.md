# ack/seen 写入收口与打开会话自动 seen

## Goal

把散落在 3 处的 ack 双写收敛为单一 API，并引入 `seenAt`（真正打开/看着会话）作为 Done 的第二条已读通道。

## Requirements

- R1 ~~新增独立 `seenAt` store~~ → **实现改为单通道**：`markAgentSeen` 直接把时间写进既有的 `doneAckedAtAtom`。理由见父任务 `design.md §3`：多一个 map 会逼 7 个展示面各读两份再自行合并，正是本次 bug 的成因。
- R2 新增 `frontend/app/agent-status/agent-status-ack.ts`：
  - `ackAgentStatus(blockId, status, source)` → 写 fp map + `doneAckedAt` + `ackBumpAtom`
  - `markAgentSeen(blockId, source)` → 写 `doneAckedAt`（source=`block-focus`）
  - `resolveAgentDoneAckedAt(blockId)` → 供非 React 消费面构造 view 入参
- R3 替换现有写入点（行为等价，仅收口）：
  - `view/term/term-model.ts:696-697`
  - `block/block.tsx:637-650`
  - `session-overview/session-overview.tsx` 的 `ackAgentStatus` / `ackTabAgentStatuses`
  - 子任务 2 在卡片 pill 里写的临时双写
- R4 新增 seen 触发点（**不含 hover**）：
  - `TerminalView` 挂载后停留 ≥ 2s（`useMarkAgentSeenOnView`）→ `markAgentSeen(blockId, "block-focus")`
  - 仅在挂载后**第一帧**状态已是未读 Done 时触发：完成事件发生在用户正在看的时候不写，否则 D 提示对当前 block 永远不亮
  - hover 卡片不算 seen
- R5 头部徽章（A）改读 `deriveAgentStatusView`（`is-acked` 现在也跟随"看过"），inline tab 点（B）的 `buildAgentStatusDot` 同理；C/D 读 `doneAckedAt` 天然跟随。
- R6 `source` 进 pslog，沿用 `D:<source>` 约定，新增 `card-pill` / `session-open` / `block-focus`。

## Acceptance Criteria

- [x] AC1 grep 断言：除 `agent-status-ack.ts` 外，无任何文件直接 `markDoneAcked(` / `markAgentStatusAcked(`（测试文件除外）。
- [x] AC2 打开会话详情后回到卡片，Done 已是 seen（灰）；仅 hover 卡片 5s 不变 seen。
- [x] AC3 新一轮完成跳变后 seen 自动失效（复用既有 `observeAgentStatusTransition → clearDoneAcked`）。
- [x] AC4 跨窗口：窗口 A ack，窗口 B 的卡片同步变灰（复用 `doneAckedAtAtom` 的 `storage` 事件）。
- [x] AC5 `npx tsc --noEmit` + `app/agent-status` / `app/block` / `app/session-overview` vitest 全绿。

## Notes

- 不复用 `blockViewedAtAtom`（服务会话消息未读，语义不同）。
- seen 只在"进入非 idle"时清除，不在 idle 时写——避免"看一眼就 ack"。
