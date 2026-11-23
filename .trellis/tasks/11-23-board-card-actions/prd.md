> **Confirmed: 2026-11-23 @nita**

# PRD：看板卡补齐能力 — 恢复 agent + composer

> 父：`11-23-session-surface-fixes-1123`（优先级序 4，M）

## Goal

Overview **看板卡**与列表行能力对齐：能「恢复 agent」、能直接发消息，不用切回列表。

## 已拍板（2026-11-23 nita：ok go）

- **D1 = A**：本轮只做「块在、agent 挂了 / 会话可重开」的恢复 —— 即用
  `AgentResumeCommand` 把**卡片对应的会话**恢复到卡片所在 tab 的新块（不抢焦点）。
  「会话在、块已关」的孤卡（看板目前没有这种卡）归 `11-23-session-card-unify`。
- **D2 = 浮层面板**：看板卡的 composer 用 FloatingPortal 浮层盖在卡上，不撑列宽。

## 需求

- R1 **恢复/唤醒**（决策 D1，推荐"两者都要"）：
  - R1.1 卡片对应会话**没有活块** → 显示「恢复」，走 `RpcApi.AgentResumeCommand`
    （11-21 已交付：按会话恢复 agent 块，`--tab` 指向卡片的 tab，`--no-focus`）；
  - R1.2 卡片**有块但 agent 已退出/idle** → 「唤醒」，复用 composer 发一条默认文本（可编辑）。
- R2 **composer**：卡片上悬出「发消息」热区 → **浮动面板**（决策 D2 推荐）盖在卡上方，
  内含 textarea + 「发送后等回复」勾选；发送/映射逻辑**复用** `overview-card-send.ts`（不复制）。
- R3 失败原地展示（`⚠ code [重试]`），不弹窗；`E_AGENT_NOT_READY` 给「改为不等待」。
- R4 热区纪律：头像/emoji/动作按钮各自 `stopPropagation`；卡片主体点击仍是开详情。

## 验收判据（数字）

- 单测：看板卡 action 可见性矩阵（无块/有块 idle/有块 working）× 恢复/唤醒 按钮文案与可用性 ≥6 用例。
- 真机（`overview-ux` 加断言）：
  - 无块卡点「恢复」→ 2s 内出现新块且卡片变活卡；
  - 看板卡发 `CARD_OK` → 收到回复（浮层内显示），列表视图未受影响；
  - 像素回归 `overview-board` 79/79 不退化。

## 依赖

- `11-21-agent-resume`（`AgentResumeCommand`）、`11-22-overview-card-send`（`overview-card-send.ts`）。

## 不做

- 不做卡片融合（见 `11-23-session-card-unify`）；不动看板列宽/布局。
