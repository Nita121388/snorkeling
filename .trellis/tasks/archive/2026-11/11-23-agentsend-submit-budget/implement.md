# Implement：提交确认时间预算 + 回执诚实

## 0. 红证

`pkg/wshrpc/wshserver/submitbudget_test.go`：
- `TestSubmitRetryBudgetScalesWithWaitMs`（四点断言，见 prd 判据）
- `TestDispatchFinalStateHonest`（confirmed/unconfirmed 两分支）

判定：`go test ./pkg/wshrpc/wshserver -run 'SubmitRetryBudget|DispatchFinalState'` → 编译失败/断言失败（红）

## 1. `agentsend.go`：预算函数 + 循环条件

```go
// SubmitRetrySafetyCap 是绝对上限，只为防止 verifyms 被设成极小值时空转；
// 真正的预算来自 SubmitWaitMs（时间驱动），不再用固定的 64 次。
const SubmitRetrySafetyCap = 2000

func submitRetryBudget(submitWaitMs, verifyMs int) int {
    if verifyMs <= 0 { verifyMs = DefaultSubmitVerifyMs }
    if submitWaitMs <= 0 { submitWaitMs = DefaultSubmitWaitMs }
    n := submitWaitMs/verifyMs + 4
    if n > SubmitRetrySafetyCap { n = SubmitRetrySafetyCap }
    if n < 8 { n = 8 }
    return n
}
```

`confirmSubmit`：`budget := submitRetryBudget(submitWaitMs, ackWindowMs)`；
循环条件改 `for retries <= budget`；保留 `deadline`（时间）与 ctx 检查；日志补 `budget=%d`。

## 2. `agentdispatch_rpc.go`：诚实回执

```go
// dispatchFinalState 把投递结果映射成回执终态：未确认必须落 failed（可 retry），
// 绝不能用 StateConfirmed——Transition 在 confirmed 分支会清空 Error，等于谎报成功。
func dispatchFinalState(result *wshrpc.AgentSendResult) (agentdispatch.State, string)
```

worker 末尾改为 `state, msg := dispatchFinalState(result); _ = store.Transition(rec.DispatchId, state, msg)`。

判定：`go test ./pkg/wshrpc/wshserver ./pkg/agentdispatch ./cmd/wsh/cmd -count=1` 全 ok + `go build ./...` 过。

## 3. 真机

`node scripts/verify/commontext-create-send/verify.mjs` → 全绿（`submitconfirmed` PASS，`retries` 可 >64）。
同时把台子里 `dispatch-submit-confirmed` 的弱断言（只看 `state=confirmed`）改成看 `submitconfirmed` 证据。

## 出界即停

touch：`pkg/wshrpc/wshserver/agentsend.go`、`agentdispatch_rpc.go`、`submitbudget_test.go`、
`pkg/agentdispatch/**`、`scripts/verify/commontext-create-send/**`、`scripts/verify/README.md`、
`docs/project/verify-ledger.md`、`.trellis/spec/**`、`loop/**`。
改 DTO/CLI/MCP/前端 = 停，报告。
