# PRD：Agent 卡常驻发送状态 + 异步派发可追溯

> 父任务 `11-24-overview-agent-batch`。需求 R6/R7，方案 `../11-24-overview-agent-batch/design.md` §4/§6，步骤 `implement.md` P2.3/P4。

## Goal

让「我发出去的那句话现在到哪了」在看板卡与列表行上始终可见，并让新建 agent 的首发异步派发可追溯（修掉 292/aaaa 事故的认知盲区）。

## 背景（必须保留）

「292/aaaa」事件取证结论：用户没觉得自己发过这条内容，因为「新建 Agent」的首发消息走 `async:true` 后台派发，**整个投递过程 UI 完全不可见**（`session-overview.tsx:3079`）。发送状态不常驻 = 用户无法把"我填过内容"与"会话里出现 user 消息"联系起来。

## R6 常驻发送状态

- 现状：行程状态只在**展开的 composer** 里渲染徽章（`overview-card-send-panel.tsx:385-405`）；卡片折叠/列表行上完全看不到。
- 目标：看板卡 + 列表 agent 行常驻 `SendStatusChip`，数据源 `CardSendContext`，文案/配色只取 `CardSendPhaseLabelKey` / `CardSendPhaseTone`。
- 约束：无记录不占位；成功态 3s 后自动淡出；点击 chip 重开该卡 composer；不新增全局轮询。

## R7 异步派发可追溯

- 现状：首发消息只 `console.warn` 失败；回执 API 已存在（`AgentDispatchListCommand` / `AgentDispatchGetCommand`，`wshclientapi.ts:58,64`），但 UI 未用。
- 目标：建块后卡片立刻显示「正在派发」，随回执推进到 pending → delivering → confirmed / failed。
- 已知限制（父 PRD D4）：`pkg/agentdispatch` Store **纯内存，重启即丢**（`agentdispatch.go:57-66`）。v1 只做应用存活期可见性；重启后无记录**不得**显示「未发送」。

## 验收判据

```bash
npx vitest run frontend/app/session-overview/send-status-chip.test.tsx && echo STATUS_CHIP_OK
```
→ `STATUS_CHIP_OK`

```bash
npx vitest run frontend/app/session-overview/overview-dispatch-status.test.tsx && echo STATUS_DISPATCH_OK
```
→ `STATUS_DISPATCH_OK`

单测覆盖：无记录不渲染；sending 显示秒数；终态自动淡出；点击回传 blockId；queued 后立即有状态；receipt confirmed 推进并清稿；重启无记录不显示未发送；重查次数有上限。

## 非目标

不落盘派发记录（另开包）；不做手机端/CLI 的对应 UI。
