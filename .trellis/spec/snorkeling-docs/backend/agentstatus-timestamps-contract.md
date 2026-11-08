# Agent 状态时间戳契约（activeSince / phaseSince）

> 状态：有效 · 2026-11-08 建立（N-1108 徽章时长修复）

`pkg/agentstatus` 里 `AgentStatus` 有**两个**「起点」时间戳，粒度不同、消费方不同。
混用会让两个面同时出错，所以把它写成契约。

| 字段 | 语义 | 何时重置（Go 侧唯一实现） | 谁读它 |
|---|---|---|---|
| `activeSince` | **state 段**起点 | 同一 source 上一条的 `state` 变了（或首条报告） | Overview 时间线条「当前状态段」起点（`overview-timeline-model.ts:304`） |
| `phaseSince` | **阶段段**起点 | `state` / `phase` / `toolName` **任一**变了（或首条报告） | 状态徽章跑时（`agent-status-chip-view.ts` `runtimeStart()`）、AISessions Run 徽章（`session-run-badge-view.ts`） |

前端读取顺序统一为 `phaseSince ?? activeSince ?? updatedAt`：旧后端 / 旧事件不带
`phaseSince` 时行为与过去一致，不会出现空跑时。

## 为什么必须是两个字段

pi 扩展在每次 `tool_call` 上报 `working / phase=tool / toolName=X`，claude 的
`PreToolUse` 同样带 `tool_name`（`hookinstall.go`）。**这些上报的 `state` 恒为
`working`**，所以：

- 只用 `activeSince` 当徽章起点 → `Tool: Bash` 换到 `Tool: Read` 时长继续累加，
  徽章显示整轮 working 的总时长（N-1108 的 bug）。
- 把 `activeSince` 改成按 phase 重置 → Overview 时间线条的
  `activeSince < to`（`to = min(session.updatedAt, now)`）前置条件常常不成立，
  时间线从「unknown 历史段 + 当前色段」塌成一整段，真机肉眼可见回归。

## 不变量（改动前先读）

1. **两个时间戳都不参与 `sameStatus` 比较**（`agentstatus.go` 的
   `sameStatus` 明确注释排除 `UpdatedAt` / `ActiveSince`）。`phaseSince` 同理：
   它只是事件时间戳，不是状态语义。让它参与比较会让每次 renew 都重新发射
   canonical 事件、重新点亮未读。
2. **`statusFingerprint` 不含任何时间字段**（`agent-status-unread.ts`）。read/unread
   只认 `state/phase/toolName/source/seq`，所以调时间戳不会影响 ack 视觉。
3. **`phaseSince` 的重置只在 Go 侧实现一次**。前端不得自己用 `updatedAt` 或相位
   变化推算「这次工具跑了多久」—— 那会变成第二份事实来源，与后端不同步。
4. **`agent-status-service.ts` 的 `normalizeCanonicalAgentStatus` 是白名单式构造**：
   新增任何 `AgentStatus` 字段都必须同步加进 `RawCanonicalAgentStatus` 与返回对象，
   否则字段在 RPC → store 这一跳被静默丢弃（`phaseSince` 加过一次，别忘）。
5. `frontend/types/gotypes.d.ts` 是生成文件：改 Go struct 后跑
   `go run cmd/generatets/main-generatets.go`（`task generate` 的 generatets 部分），
   不要手改。

## 已知边界

- codex 的 batch/shell hook 只传 `state` + `phase`，不带工具名 → codex 的
  `phaseSince` 只能到相位级（`Tools` 段整段计时），这不算 bug。
- 徽章跑时只在活跃态（`working` / `blocked` / `stale`）显示，见
  `needsAgentChipRuntime()`；`done` 态走分钟级 `Done 3m`，不显示秒级跑时。
- 同一工具连续上报（pi 的 `renewWorking` 每 ≥30s 一次）**不**重置 `phaseSince`，
  否则长工具会被切碎成一个个 30s。
