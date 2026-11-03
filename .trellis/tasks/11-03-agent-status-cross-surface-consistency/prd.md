# Agent 状态跨面一致性：Overview chip 与 agent Block 头部徽章对齐

## Goal

让同一个 agent block 的状态在**所有展示面**给出同一个结论（同 state、同文案、同 unread/ack 语义），特别是：

- `Session Overview` 列表里的状态 chip
- agent Block（terminal block header）上的状态徽章
- inline tab 状态点 / 顶部 app tab 圆点 / Tab 悬浮卡（同源消费者）

当前用户可复现的异常：Overview 显示 `Done`，block 头部显示 `Idle 10m`/`Seen`；在一边点击 ack 后另一边又"复活"。

## Background（调研实测证据）

代码事实：

1. **Block 头部**（`frontend/app/view/term/term-model.ts:642-707`）读 `AgentStatusStore.acquire(blockId)` 的 presented atom；该 atom 只做 `applyStaleness()`（`frontend/app/agent-status/agent-status-store.ts:132-142`），不参与 `idle→done` 派生。
2. **Overview chip**（`frontend/app/session-overview/session-overview.tsx:328-396` + `2144-2175`）走自己的一套：独立 `new BlockServiceType().GetAgentStatus()` 拉取 + 独立 `agentstatus` 事件订阅，再用 `presentAgentStatus({canonicalStatus, controllerStatus, sessionUpdatedAtMs, viewedAtMs, nowMs})`（`frontend/app/agent-status/agent-status-derive.ts:154-188`）把 `canonical idle + 未读 session 更新（15 分钟内）` 转成 `state:"done", source:"session"`。
3. **ack 共用一份 map 但 fingerprint 来源不同**：两侧都写 `SessionOverviewModel.agentStatusAckedFpAtom[blockId]`（`session-overview-model.ts:107`、`178-196`），但 Overview 用 **presented（done/session）** 的 `statusFingerprint`，头部用 **canonical presented（idle/hook）** 的（`term-model.ts:652-656` + `agent-status-unread.ts:14-23`）。

实测（临时 vitest 复现后已删除）：

```
header status : idle  hook   fp ["v2","claude","s1","hook",7,"idle","none",""]
overview status: done  session fp ["v2","claude","s1","session",7,"done","none",""]

ack 写 overviewFp  → overview 已读，header 仍 unread = true
ack 写 headerFp    → header 已读，overview 立刻重新亮起 = true
```

另两条实测：

- session 更新距今 >15min 时：Overview 退回 `idle`（chip 被 `shouldShowAgentStatusChip` 隐藏），而头部 `isAgentDoneUnread(canonical, 0) === true` 仍亮 D（"Idle 16m"）。→ 15 分钟悬崖造成永久性分歧。
- canonical 为 `null`（无 hook 上报，如 gemini）但 session 有新更新时：Overview 派生 `done` 并显示 chip，头部 `status == null` 直接不渲染任何徽章。

## Requirements

- R1 **单一呈现源**：由 `AgentStatusStore` 产出"最终呈现态"（含 `done` 派生、`stale` 衰减），Overview / 头部 / inline tab / tab 圆点 / 悬浮卡全部读同一个 atom。
- R2 **删除 Overview 的重复订阅**：Overview 不再自己 `GetAgentStatus` + 订阅 `agentstatus`；改为 acquire store。
- R3 **ack 语义统一**：所有面写同一个 fingerprint，且该 fingerprint 由同一个 presented status 计算；点击任一面 ack 后所有面同时变已读。
- R4 **完成语义统一**：`done` 的判定只保留一套（canonical `prevState` + `completedAt` 与 `doneAckedAt` 比较为主，session 窗口仅在 canonical 无跳变信息时兜底），且两侧标签文案一致。
- R5 **文案统一**：presented state 为 `done` 时，头部徽章文案与 Overview chip 都是 "Done"（不再出现 "Idle 10m"）。
- R6 **消除 15 分钟悬崖**：`done` 不会因为时间流逝而单侧消失；要消失只能靠 ack 或新的 agent 事件。
- R7 **viewedAt 统一更新**：聚焦某个 agent block 时（无论从 Overview 还是 Tab 里点进去）都更新同一份 viewedAt，避免"用户正看着却显示未读 Done"。
- R8 **保留 provider 无 hook 的降级**：canonical 为空但 session 有活动时，Overview 与头部行为一致（要么都显示 done 派生，要么都不显示，需在 design 定一个）；不允许只有一边亮。
- R9 补回归测试：跨面一致性（同 block 同 presented state / 同 fingerprint / 同 unread）+ 上面三条实测场景。

## Non-goals

- 不重做 Go 侧 `pkg/agentstatus` 状态机（canonical 语义保持不变）。
- 不改 D/C/B 各层"要不要显示状态点"的降噪策略（只统一输入与 ack，不改显示阈值策略本身，除 R6 的悬崖）。
- 不引入 OS 通知/托盘相关改动。

## Acceptance Criteria

- [x] AC1 Overview chip 与 block 头部对同一 block 的 `state` 完全一致（`done/working/stale/blocked/idle` 同一判定）。
- [x] AC2 在 Overview 点 ack 后，block 头部徽章立即变 `is-acked`；反向亦然；切换 tab / 重挂载后不复活。
- [x] AC3 agent 完成后超过 15 分钟，两侧要么都仍显示 Done，要么都隐藏（不允许单侧消失）；实际取值按 design 决定并写测试。
- [x] AC4 canonical 为空但 session 有更新的 provider（gemini 等），两侧显示一致。
      *注：S1-S4 后两侧一致地"都不显示"（canonical null → null）。Q2=A 要求"两侧都显示推断态"，
      需共享 session 活动数据源，已降级为 S5 后续增强，不在本次 core 修复内。*
- [x] AC5 头部与 Overview 的 done 文案一致（"Done"），不再出现 "Idle 10m" 与 "Done" 并存。
- [x] AC6 现有 `frontend/app/agent-status/*.test.ts`、`session-overview/*.test.ts`、`term` 相关测试全绿。
- [x] AC7 新增至少 3 条跨面一致性测试（对应实测 A/B/C 场景），且删除临时复现文件。

## 决策记录（2026-11-03，用户确认：全部按推荐）

- **D-Q1 = A**：`done` 长期保留直到下一次非 idle 事件或用户 ack；ack 只灰化，不撤销 state。24h 自动降噪不在本任务范围。
- **D-Q2 = A**：无 hook provider 允许用 session 活动派生 done，且两侧一致显示 inferred 派生态。
  - 实施拆分：S1-S4 先做到"两侧一致"（此时无 hook provider 两侧都不显示，等价 Q2 的 B）；
    "两侧都显示派生态"需要共享的 session 活动来源，作为 S5 在同一任务内补做。
  - 若 S5 因数据源不可靠无法落地，则退回 B 并把 AC4 改写为"两侧均不显示"，需在收尾时告知用户。
- **D-Q3 = A**：接受把 `blockViewedAtAtom` 提升为 agent-status 层共享来源（包兼容 getter），
  并在 agent block 被聚焦时统一更新。S1-S4 后 chip 状态不再依赖 viewedAt（只影响列表"未读消息"计数），
  因此该迁移降级为 S5 的可选项。

## 执行分期（已确认）

- S1-S4：核心一致性 + ack 统一 + 文案统一（本次实施）
- S5：无 hook provider 的 inferred done + viewedAt 共享（本次任务内补做，若受阻则在收尾说明）
