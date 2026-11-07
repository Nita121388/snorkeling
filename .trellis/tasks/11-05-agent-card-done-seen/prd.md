# Agent 卡片 Done 随 seen 状态联动

## Goal

同一个 agent block 的「完成态」在**所有展示面**给出同一个 read 语义：agent 悬浮卡、Tab「更多」里的 agent 行、Tab 悬浮卡上的 agent 状态 pill 当前永远显示高饱和绿色 `Done`，即使用户已经在 block 头部徽章 ack 过、或已经打开会话看过。

## 背景（代码事实）

现状只有 4 个面接了「已读」判定，3 个卡片面完全没接：

| 面 | 位置 | 读 read 状态 |
|---|---|---|
| A agent block 头部徽章 | `view/term/term-model.ts:641-712` | ✅ fp ack + doneAckedAt |
| B inline tab 状态点 | `block/block.tsx:350-380,610-660` + `block/inlinetab-agent-status.ts` | ✅ |
| C 顶部 app tab 圆点 | `agent-status/agent-status-tab-aggregate.ts:230-370` | ✅ |
| D Session Overview chip | `session-overview/session-overview.tsx:919,1674,1905` | ✅ |
| E Agent 悬浮卡 / AgentCardModal | `view/term/agent-hover-card.tsx:107-125` | ❌ 只有 `agentStatusPresentation().label` + `--agent-done-color` |
| F Tab「更多」AgentMiniRow | `tab/tab-more-agent-card.tsx:117-130` | ❌ |
| G Tab 悬浮卡 agent pill | `tab/tab-info-card.tsx:79` → `tab/tab-info-card-model.ts:112 presentAgentState` | ❌ |

根因：

- `presentCanonicalAgentStatus`（`agent-status/agent-status-derive.ts:262`）只把 `idle + prevState≠idle` 提升为 `done`，**没有 read 维度**；read 靠每个消费面自己叠 `isAgentDoneUnread`。没叠的面永远 Done。
- seen 没有单一事实源：`agentStatusAckedFpAtom`（R 类指纹）、`agentStatusDoneAckStore.doneAckedAtAtom`（D 类时间戳）、`session-overview-model.blockViewedAtAtom`（只喂会话消息未读）三份互不相认；打开会话不 ack D。

## Requirements

- R1 **单一呈现源**：新增 `deriveAgentStatusView()`，输出 `{state, phase, label, tone, read, elapsedText, title, ackable}`；A–G 全部由它派生，不再各自算 ack。
- R2 **不改 canonical 状态机**：`presentCanonicalAgentStatus` / Go `pkg/agentstatus` 语义保持不变（`done` 仍是粘性状态），只在 view 层加 `read`。
- R3 **read 判定表**（写进单测）：
  - `working / blocked / error / rate-limited / stale` → `fp === ackedFp ? "seen" : "unread"`
  - `done` → `completedAt > resolveAgentSeenAt() ? "unread" : "seen"`
  - `idle`（无跳变）/ `unknown` → `"seen"`（不点亮）
- R4 **seen 通道同落点**：显式 ack 与「切到该 block 停留 ≥ 2s」都写 `doneAckedAt`（详见 design.md §3 的落地调整），hover 卡片**不算** seen。
- R5 **ack 写入收口**：新增 `ackAgentStatus(blockId, status, source)` / `markAgentSeen(blockId, source)`，替换 `term-model.ts`、`block.tsx`、`session-overview.tsx` 里散落的双 store 直写（AC：除收口模块外无文件直接写两个 store）；卡片 pill 在 `ackable` 时可点击 ack。
- R6 **视觉契约**：unread Done = `--agent-done-color` + 呼吸动画 + `Done 3m`；seen Done = `--secondary-text-color` + 无动画 + `Done`。CSS 类 `.is-seen` 与 `.is-done-unread` 互斥。
- R7 **不引入时间悬崖**：Done 不会因为时间流逝单侧消失（15 分钟窗口不再参与 read 判定）。

## Non-goals

- 不重做 Go `pkg/agentstatus` 状态机。
- 不改 B/C 两层「要不要显示状态点」的降噪阈值。
- 不改会话消息未读（`summary.updatedAt` vs `blockViewedAt`）的既有语义，只读复用其时刻值。
- 不改 OS 通知 / 托盘。

## Acceptance Criteria

- [x] AC1 同一 block 完成后，在 A/B/C/D 任一面 ack → E/F/G 三个卡片面**同帧**变 seen（颜色/动画/文案一次到位），切 tab、重挂载、开弹窗都不复活。
- [x] AC2 新一次完成跳变（working → idle）→ A–G 全部回到 unread，无需刷新。
- [x] AC3 打开该会话（前台停留 ≥ 2s）后，E/F/G 变 seen；仅 hover 卡片不变 seen。
- [x] AC4 `deriveAgentStatusView` 表驱动单测覆盖 R3 全部分支；跨面契约测试断言 7 个面读到同一 `read`。
- [x] AC5 `presentCanonicalAgentStatus` / `agentStatusPresentation` 行为零变更（既有测试全绿）。
- [x] AC6 `npx tsc` + 相关 vitest 通过；不新增 lint 错误。

## 子任务地图

1. `11-05-agent-status-view-core` — 纯函数 + 单测（零 UI 变更）。
2. `11-05-agent-card-seen-surfaces` — E/F/G 三面接入 + `.is-seen` 样式 + pill ack。
3. `11-05-agent-ack-seen-writers` — ack/seen 写入收口 + 打开会话写 seenAt。

依赖顺序：1 → 2 → 3（3 依赖 1 的 `resolveAgentSeenAt`；2 依赖 1 的 view 输出）。
