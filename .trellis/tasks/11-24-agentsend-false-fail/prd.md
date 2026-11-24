# PRD：发送链路假失败修复（P1）

> 父任务 `11-24-overview-agent-batch`。需求 R8，方案 `../11-24-overview-agent-batch/design.md` §5，步骤 `implement.md` P0。

## Goal

消除「消息已注入并提交，但 UI 显示红色『发送失败』」的假失败，并阻止由此引发的重复投递。

## 现状（已核实，勿重新调研）

- 客户端超时：`cardSendRpcTimeoutMs()` 默认 80s（`overview-card-send.ts:58-64`）；非等回复路径硬编码 60s（`overview-card-send-panel.tsx:118`）。
- 服务端最坏：`DefaultSendWaitMs 30s` + `DefaultSubmitWaitMs 180s` + `ReplyWaitMs 60s` ≈ 270s（`agentsend.go:29-58`）。
- 客户端先超时 → reject `EC-TIME: timeout waiting for response`（`wshrpcutil-base.ts:28`）→ `outcomeFromSend` 无条件判 `failed`（`overview-card-send.ts:110-120`）→ 草稿保留（`:123`）→ 用户点[重试] → **重复投递**。

## 需求

- R8.1 客户端超时覆盖服务端全预算（注入前 210s + 等回复窗口 + 20s 余量，上限 360s）。
- R8.2 超时/取消类错误 → 新行程态 `unknown`（文案「结果未知（可能已送达）」，tone `warn`），不是 `failed`。
- R8.3 `unknown` 态 **不渲染重试按钮**；只给 [查状态] [继续等]。
- R8.4 真失败（带 `E_XXX` 且非超时）保持 `failed` + [重试] + 草稿保留。
- R8.5 `unknown` 态二次发送需二次确认。

## 验收判据

```bash
npx vitest run frontend/app/session-overview/overview-card-send.test.ts && echo PRD_ST_OK
```
→ `PRD_ST_OK`

```bash
npx eslint frontend/app/session-overview && echo PRD_ST_LINT_OK
```
→ `PRD_ST_LINT_OK`

单测必须覆盖：`EC-TIME` → `unknown`；`E_BLOCK_NOT_READY` → `failed`；`cardSendRpcTimeoutMs(60000,true)===290000`；`cardSendRpcTimeoutMs(undefined,false)===230000`；unknown 态不清稿；unknown 态无重试按钮。

## 非目标

不改服务端预算常量；不改 AISessions/CLI 的发送路径。
