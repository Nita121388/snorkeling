> **Confirmed: 2026-11-21 @nita**

# Agent Roundtrip：等回合完成收回复 + session wait

## Goal

补上多 agent 通信缺的最后一段：**发出去 → 等对方答完 → 直接拿到回复**。`wsh agent send --wait-reply` 在注入后等待目标 agent 回合完成并返回本次回复摘要；`wsh session wait` 给「等某个会话进入某状态」的通用原语（Herdr `agent wait --until` 同款）。CLI + MCP 双形态。

## 现状（关键事实）

- `agent send` 是 fire-and-forget：注入成功即返回，回复只能靠 `session turns/turn` 反复读（11-18 PRD 明确的 non-goal）。
- 状态信号有三处可用：`agentstatus`（block 级 running/idle）、会话 JSONL 文件（mtime/size）、会话索引 turn 计数（`session info` / `turns`）。
- 会话数据**会不全**（`docs/answers/multi-agent-orchestration-20261121.html` 面板 L）：pi 首条回复前无文件、半截 JSON 被丢、按预算截断。所以判完成**必须多信号**，不能只信「出现新 assistant turn」。
- `agentsend.go` 已有异步派发（`Async` + dispatch 三段回执，11-21-agent-dispatch-queue），`wait-reply` 与 async 互斥。
- Orca 的「结束回合 + 唤醒」是另一条路（不阻塞），本包 v1 走同步等待 + `--no-wait` 逃生口。

## Requirements

### R1 `agent send --wait-reply`

- 在现有注入成功之后追加等待窗口：
  - 基线：注入前的 `agentstatus seq/state`、目标会话 JSONL `mtime+size`、`turnCount`；
  - 完成条件（三信号同时满足）：`agentstatus` 非 running、文件 `mtime/size` 变化、`turnCount > 基线`；
  - 轮询间隔 250ms（可配），总超时 `--reply-wait-ms`（默认 60000，上限 300000）。
- 返回：`replied`（bool）/ `turn` / `replyText`（`--reply-chars`，默认 2000，上限 8000，超出标 `truncated`）/ `totalChars` / `waitedMs` / `warnings`。
- 超时**不报错**：`replied=false` + `warnings:["reply-timeout"]`，退出码 0（发送本身成功）；调用方按 JSON 判断。
- `--no-wait`：注入后立即返回 baseline（cursor = `turnCount`），之后用 `session turns --before-turn` 自取；`--wait-reply` 与 `--no-wait` 同时出现 → `E_USAGE`。
- 与 `Async` 同用 → `E_USAGE`（异步派发不能同步等回复）。
- 未注入成功（`injected=false`）→ 不进入等待，直接返回原错误。

### R2 `session wait <identifier> --until idle|blocked|done|working`

- 轮询 `agentcontrol` 的 live record / `agentstatus`，直到状态命中或超时（`--timeout-ms` 默认 60000，上限 300000）。
- 命中 → `{matched:true, state, waitedMs}`；超时 → 退出码 3（区别于错误），JSON `matched=false`。
- 会话不存在 → `E_NOT_FOUND`。

### R3 MCP

- `snorkeling_agent_send` 增加 `waitreply / replywaitms / replychars / nowait`；
- 新增 `snorkeling_session_wait`（scope observe）。
- schema 快照 + scope 测试。

## Non-goals

- 唤醒模型（不阻塞回合、事件推送）——v2，另立任务。
- 多轮对话编排 / 结果合并 / 组寻址（@all 等）——另行评估。
- headless/ACP 通道（信号会更干净，但属接入层改造）。
- 修改 `agentstatus` 判定逻辑本身。

## Acceptance Criteria（机器可判定）

1. `go build ./...` → exit 0；`go test ./pkg/wshrpc/wshserver ./pkg/agentcontrol ./pkg/agentmcp ./cmd/wsh/cmd` → 0 fail。
2. 纯函数单测：完成判定器（三信号 × 6 组状态矩阵）——只 idle 不算完成、只增长 turn 不算完成、三者齐才完成。
3. 参数校验单测：`--wait-reply`+`Async` → `E_USAGE`；`--wait-reply`+`--no-wait` → `E_USAGE`；`--reply-chars` 越界夹紧。
4. 真机（dev 实例）：向 pi 块 `send 'reply with exactly: ROUNDTRIP_OK' --wait-reply --reply-wait-ms 120000 --json` → `replied=true`、`replyText` 含 `ROUNDTRIP_OK`、`waitedMs>0`。
5. 真机超时：`--reply-wait-ms 5000` 对慢任务 → `replied=false`、`warnings` 含 `reply-timeout`、退出码 0。
6. 真机 `--no-wait`：立即返回 + `turn` 基线；随后 `session turns --before-turn <cursor+1>` 能读到回复。
7. 真机 `session wait`：目标块 working → `--until idle` 命中；不存在会话 → `E_NOT_FOUND`。
8. MCP：`agent_send` 新参数生效（真机一次 `waitreply=true`），`session_wait` 可用；schema/scope 快照通过。
9. verify area `agent-roundtrip` exit 0；`verify-ledger.md` 入账；实例自动关闭。

## Notes

- loop 工作项：`F-1121-agent-roundtrip`（arch 类）。
- 与 11-21-agent-resume 独立，可并行；两者共同构成外部 agent 的「续上 + 收结果」。
- 四家对账依据：`docs/answers/multi-agent-orchestration-20261121.html`（Herdr `agent wait --until`、Paseo `waitForFinish`、Orca 唤醒模型）。
