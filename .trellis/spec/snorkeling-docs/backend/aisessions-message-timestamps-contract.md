# AI 会话消息时间戳契约（turn 级时间语义）

> 来源：2026-11-25 `11-25-overview-turn-gantt`（Overview 时间线 G3 按对话轮拆分）。
> 真机验证：真实 pi 会话 192 条消息，`~/.pi/agent/sessions/**/*.jsonl` + 本仓 SQLite 索引 `ai_session_messages`。
> 代码：`pkg/aisessions/provider_pi.go`（解析）、`pkg/aisessions/sqlite_read.go`（`TurnSpanOf`）、
> `pkg/aisessions/sessionread.go`（`ReadTurns` / `SessionTurnRow`）。

## 1. Scope / Trigger

任何「从消息时间戳推时长」的功能（Overview 甘特、会话详情耗时、性能分析、审计）都先读这条契约。
出现「思考时长准不准 / 为什么工具显示 0.5s / 能不能算出纯思考时间」这类问题时，答案在这里。

## 2. 一条消息 = 一个条目时间戳，条目内时间不可分

- 每个 JSONL 条目（user / assistant / toolResult）只有一个 `timestamp`。
- 一个 assistant 条目可能同时含 **thinking 块 + 正文 + N 个 toolCall**，
  `provider_pi.go` 会把它拆成「正文消息 + N 条 `[Tool: name]` 锚点消息」，
  **拆出来的所有行共享同一个时间戳**。
- 因此：`thinking` 只能回答「有没有思考」，不能回答「思考了多久」。
  要秒级纯思考时长，必须由上游在 JSONL 写分块时间戳——**本项目不做这个改动**。

## 3. 时间戳语义：assistant 条目 = 生成完成 / 工具发起时刻

真机实测相邻消息时间戳差（192 条消息会话，中位数）：

| 转移 | 中位 | 结论 |
|---|---|---|
| `assistant+toolCall → toolResult` | **0.5s** | assistant 条目时间戳 = 生成完成、工具刚发起 |
| `toolResult → assistant+toolCall` | **9.5~12.4s** | 模型侧耗时（思考 + 决策 + 网络） |
| `user → assistant+toolCall` | 10.9s | 首段模型侧耗时 |
| `assistant → user` | 135.5s | 真实空闲（等人） |

反推验证：若 assistant 条目时间戳是「生成开始」，则 `assistant → toolResult` 必须包含整段生成，
不可能中位 0.5s 而 `toolResult → assistant` 却是 9.5s。

## 4. 可推导的段（唯一口径）

```
think 段 = t(assistant+toolCall) − t(上一条消息)      // 估算：模型往返（含网络+正文生成）
tool  段 = t(toolResult) − t(assistant+toolCall)      // 精确
reply 段 = t(末条 assistant 文本) − t(最后 toolResult) // 含思考，与 think 同族
idle  段 = t(下轮 user) − t(本轮末条)                  // 精确
完成点   = t(本轮末条)                                 // 精确
```

硬规则：

1. `think` / `reply` 面向用户的 UI **必须标“估算”**（斜纹或文字标注二选一，不能静默当精确值）。
2. 一个 assistant 条目带多个 toolCall 时，思考只算一次、不按工具数摊分（并行工具共享时间戳）。
3. 用户输入耗时不可见（发生在两条消息之间），归入 `idle`，不得算进活跃时长。

## 5. 读取性能红线（批量场景）

- **不要**用 `ReadTurns` 做看板/甘特批量取数：每页上限 10 轮、每轮多次 SQL、还带文本，
  40 行会话 × N 页会爆炸。
- 批量场景新增专用轻量读：一次 SQL 扫描（`WHERE session_key IN (…) AND timestamp >= windowStart`）
  后归并成纯数字 `[{kind, fromMs, toMs}]` + 完成点数组，RPC 不传文本。
- 消费端必须有上限：批 ≤20 会话、每会话 ≤200 轮、每行渲染段 ≤60（超限合并最窄相邻段）、
  完成点 >30 抽稀，并且**无索引/stale 会话降级**为不依赖消息时间戳的渲染，永不阻塞首屏。

## 6. 验证钩子

- 单测：给定 (seq, role, timestamp, tool_name) 行集，断言四类段切分、段数封顶、合并计数。
- 真机：随机取一个真实会话，用上述公式对 `SessionTurnRow.Ms` 交叉校验
  （`Ms = maxAt − minAt`，应与该轮各段之和一致）。
