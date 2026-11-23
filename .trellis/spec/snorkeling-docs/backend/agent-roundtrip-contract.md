# Agent Roundtrip 契约（发 → 等 → 收）

> 适用范围：`wsh agent send --wait-reply`、MCP `snorkeling_agent_send`（waitreply 组）、
> `wsh session wait`、MCP `snorkeling_session_wait`。
> 来源：2026-11-21 `11-21-agent-roundtrip`（loop `F-1121-agent-roundtrip`）。
> 对账依据：`docs/answers/multi-agent-orchestration-20261121.html`（Herdr `agent wait --until` /
> Paseo `waitForFinish` / Orca 唤醒模型）。

## 1. Scope / Trigger

TUI 通道上任何「等目标 agent 把一个回合做完」的需求都走这条契约。
headless/ACP 通道（未来）不复用本契约的判定——那里有协议级完成事件。

## 2. 判据：三信号 + 第四条件（settled）

```go
// pkg/wshrpc/wshserver/replysignal.go
type replyBaseline struct {
    agentSeq  int64      // agentstatus seq
    fileSize  int64      // 会话 JSONL 大小
    turnCount int        // 会话索引 turn 总数
    state     string     // agentstatus state（第四条件）
}
func replyComplete(base, now replyBaseline) bool  // 三信号 && replySettled(now.state)
func replySettled(state string) bool              // idle | done
```

完成 = **agentSeq 前进 && 文件变大 && turnCount 增加 && state ∈ {idle, done}**。

> **2026-11-21 真机反证**：只靠三信号时，pi 从 `agent_start→working`、user 消息落盘、
> turn 计数增加的那一刻起三信号就全齐，慢回合会立刻误判完成（实测返回时块还在 sleep 60，
> 真正的回复 68s 后才落地）。状态必须作为第四条件，`working|blocked|unknown` 一律不算完成。

**采样必须分两档**：廉价档只做 `agentstatus.Get` + `os.Stat`；只有「settled 且文件变大」才做
昂贵的 turn 读取（单次全会话解析实测 7-19s，每 poll 一次会让等待窗口失效）。

**为什么不能只看一个**（每条都有实测/结构性依据）：

| 单信号 | 为什么不够 |
|---|---|
| 只有 agentstatus 转 idle | 审批暂停、启动期扫描都会让状态抖动 |
| 只有文件变化 | TUI 每帧都在写终端日志；会话 JSONL 也可能被并发进程写 |
| 只有 turn 增加 | 半截写入时 turn 可能先出现再补全（`truncated`）；user 消息落盘也会加 turn |
| 三信号全齐但 state=working | 回合刚开始：user 消息已落盘、agent 已报 working（实测误判） |

## 3. 超时不是错误

- 超时返回 `replied=false` + `warnings:["reply-timeout"]`，**退出码 0**（发送本身成功）。
- deadline 时若三信号+settled 齐但 assistant 正文仍读不回 → `replied=true`、`replyText=""`、
  warning `reply-empty`（答复存在，索引没跟上；调用方可用 `session turn` 自取）。
- 服务端 RPC deadline 先到 → `warnings:["reply-rpc-deadline"]`，同样按超时处理。
- CLI/MCP 必须显式放大 RPC timeout 到 `replyWaitMs + 15s`（默认 60s+15s，上限 320s）；
  沿用 8s/15s 默认会让等待窗口被假杀（真机一律失败）。

## 4. 互斥与逃生口

| 组合 | 行为 |
|---|---|
| `--wait-reply` + `--async` | `E_USAGE`（同步等 vs 异步派发） |
| `--wait-reply` + `--no-wait` | `E_USAGE` |
| `--no-wait`（单独） | 立即返回 `turn` 基线（`ReplyCursor`）；之后 `session turns <id> --limit 1` 取最新回复 |

`--no-wait` 在 send 上原本是「跳过就绪静默」，本契约让它同时置 `NoWait`——
命名保留但语义扩为「不等回复」，两者自洽。

## 5. 取回复的配方

`ReplyCursor` 是**注入时的 turnCount**，不是翻页游标。取本次回复：

```bash
wsh session turns <key> --limit 1 --json          # 最新 turn
wsh session turn  <key> --turn <N> --chars 4000   # 该 turn 原文（assistant 行拼接）
```

`--before-turn` 是**向下翻页**的排他游标，用它取不到新 turn。

## 6. session wait

`session wait <key> --until idle|blocked|done|working --timeout-ms N`
- `done` 按 `idle` 处理（agentstatus 无独立终态）。
- 超时 `matched=false` + **退出码 3**（区别于错误 1）。
- 会话不存在 `E_NOT_FOUND` 立即返回，不进入轮询。

## 7. 不要动的地方

- 不要给 `agentstatus` 判定加「完成」语义——它是状态机，不是回合事件源。
- 不要用轮询终端输出（刮屏）代替三信号。
- 不要把等待窗口塞进 `Async` dispatch 状态机（那是 fire-and-forget 的三段回执）。

## 3.1 提交确认必须按「时间」退避，不按「次数」（2026-11-23 真机定案）

- 允许的补回车次数 = `submitRetryBudget(submitWaitMs, verifyMs)`：
  `submitWaitMs/verifyMs + 4`，上限 `SubmitRetrySafetyCap=2000`（防 verifyMs 被设成极小值时空转）。
- **禁止**再用固定次数上限（旧 `MaxSubmitRetries=64` × 700ms ≈ 45s，实测把 180s/600s 的
  `SubmitWaitMs` 预算砍成 45 秒，TUI 冷启动 >45s 必然 `submitconfirmed=false`）。
- 纯函数在 `pkg/wshrpc/wshserver/agentsend.go`，单测 `submitbudget_test.go` 锁四点
  （180s→≥250 次、600s→≥850 次、30s→≤50 次、单调不降）。

## 3.2 派发回执不许掩盖未确认

- `dispatchFinalState(result)`：`SubmitConfirmed==true → (StateConfirmed,"")`；
  否则 `(StateFailed, "E_SUBMIT_UNCONFIRMED: …")`。
- **禁止**无条件 `Transition(StateConfirmed, "")`：`Store.Transition` 在 confirmed 分支会
  `rec.Error = ""`，等于把失败洗成成功，UI/CLI/MCP 全都拿不到失败信号。
- `failed` 可被 `AgentDispatchRetry` 重试（`CanTransition(failed→pending)` 已成立），不新建记录。
