> **Confirmed: 2026-11-23 @nita**

# PRD：提交确认按时间预算退避 + 派发回执不许掩盖未确认

> 父：`11-23-session-surface-fixes-1123`（**新发现 P0，插到序 1 里一起修**）
> 来源：2026-11-23 真机验证 `commontext-create-send`（`verify-runs/20261123T01504-commontext-create-send`）

## Goal

让「提交确认」的时间预算真正生效（上限由 `SubmitWaitMs` 决定，而不是被 64 次退避硬掐在 ~45s），
并让派发回执在提交未确认时**如实报失败**（可重试），不再谎报 confirmed。

## 症状（真机实测）

新建 codex/pi 块后发送文本，后端日志：

```
[agentsend] … injected 48 bytes
[agentsend] … submit retries=65 confirmed=false elapsedms=45526
```

即：**补回车 45.5 秒后被「次数上限」掐断**，而 `SubmitWaitMs` 预算是 180s（同步）/600s（异步）。
TUI 冷启动超过 45s 就必然 `submitconfirmed=false` —— PRD 里"pi 冷启动 40s+"恰好越线，
于是 `waitms:120000` 传了也不起作用。**这是 CommonText 丢消息的更深一层根因。**

## 两个缺陷

- **A（P0）**：`pkg/wshrpc/wshserver/agentsend.go` `confirmSubmit` 循环条件 `for retries <= MaxSubmitRetries`，
  `MaxSubmitRetries = 64`、`DefaultSubmitVerifyMs = 700` → 硬上限 ≈ 45s，与 `SubmitWaitMs` 脱钩。
  注释自称"真正的截止时间是 SubmitWaitMs"，实现没有兑现。
- **B（P1）**：`pkg/wshrpc/wshserver/agentdispatch_rpc.go` 投递后无条件
  `store.Transition(rec.DispatchId, StateConfirmed, "")`；而 `agentdispatch.Store.Transition`
  在 `StateConfirmed` 分支会 `rec.Error = ""` → **未确认的投递回执显示 confirmed 且无错误**，
  上层（UI/CLI/MCP）据此以为发送成功。

## 需求

- R1 退避预算改为**时间驱动**：允许的重试次数由 `SubmitWaitMs / SubmitVerifyMs` 推导
  （+ 固定余量），并保留一个足够高的绝对安全上限（防 verifyMs 被设成极小值时空转）。
  截止时间仍是 `SubmitWaitMs`（原有 `deadline` 语义不变）。
- R2 退避间隔保持现有策略（ack 窗口轮询），不引入新的睡眠魔数。
- R3 派发回执诚实：`SubmitConfirmed == false` → 记录状态 `failed` + `E_SUBMIT_UNCONFIRMED`
  （可被 `AgentDispatchRetry` 重试）；`true` 才 `confirmed`。
- R4 不改 `AgentSendResult` 契约、不改 CLI/MCP 参数、不改前端。

## 验收判据（数字）

- 单测（新）：
  - `submitRetryBudget(180000, 700)` ≥ 250；`submitRetryBudget(600000, 700)` ≥ 850；`(30000, 700)` ≤ 50；
    单调不降；极端 `verifyMs=200` 时仍 ≤ 绝对上限。
  - `dispatchFinalState(result)`：confirmed → `(Confirmed, "")`；unconfirmed → `(Failed, "E_SUBMIT_UNCONFIRMED…")`。
- 真机：重跑 `scripts/verify/commontext-create-send` → `submitconfirmed` 断言 PASS
  （慢启动 TUI 不再被 45s 掐断；日志 `retries` 可超过 64）。
- 回归：`go test ./pkg/wshrpc/wshserver ./pkg/agentdispatch` 全 ok。

## 不做

- 不改 ack 信号来源（agentstatus hook 仍是一等信号）。
- 不动 `AgentSendRequest` 参数与范围（`submitwaitms` 上限仍 600s）。
