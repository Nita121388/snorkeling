> **Confirmed: 2026-11-08 @nita**

# 状态徽章时长按「当前阶段段」计算

## Goal

Agent 状态徽章（`Tool: Bash` / `Thinking` / `Working`）尾部会拼一个运行时长。用户报的现象是：
**这个时长是本次 `working` 状态累计的总时长，不是当前那一段（比如某个工具）的时长** ——
同一个会话里从 `Tool: Bash` 换到 `Tool: Read`，数字继续往上垒，不归零。

根因已核实，不在前端。`pkg/agentstatus/agentstatus.go:327-332`：

```go
activeSince := report.ReportedAt
if prevSource.State == report.State && prevSource.ActiveSince > 0 {
    activeSince = prevSource.ActiveSince   // 只比 state
}
```

pi 扩展（`hookinstall.go:580`）在每次 `tool_call` 上报 `working / phase=tool / toolName=X`，
claude 的 python hook 同样带 `tool_name`（`hookinstall.go:1030`）。**这些上报的 `state` 始终是
`working`**，于是 `activeSince` 从第一份 working 报告起就固定不动，徽章只能显示 working 总时长。

目标：徽章时长 = 当前状态段的时长（换工具、thinking↔tool 相位切换归零重计；同一工具的续报不打断）。

## 背景（代码事实，均已核对）

`activeSince` 的全部消费方（全仓扫过，Go 侧只有 `pkg/agentstatus`）：

| 位置 | 用途 | 本次是否要变 |
|---|---|---|
| `frontend/app/agent-status/agent-status-chip-view.ts:69` | 徽章 runtime（block 头部 / Overview 列表 / 看板 / 悬浮卡 / Tab 聚合 5 个变体） | ✅ 要变 |
| `frontend/app/view/aisessions/session-run-badge-view.ts:109` | AISessions 列表 Run 徽章 runtime | ✅ 要变 |
| `frontend/app/session-overview/session-overview.tsx:2345` → `overview-timeline-model.ts:304` | Overview 时间线条「当前状态段」起点 | ❌ 不许变 |
| `frontend/app/agent-status/agent-status-derive.ts:123/174` | session 源推导的 done/idle 自写，不读后端值 | ❌ 不涉及 |

不受影响的旁支（已逐条确认）：

- **read/unread 判定**：`statusFingerprint` 只含 provider/sessionId/source/seq/state/phase/toolName，不含时间字段。
- **状态事件发射**：`sameStatus` 明确注释「UpdatedAt, ActiveSince 排除在比较外」，state/phase/toolName 本就参与比较。
- **stale 看门狗**：用 `updatedAt`。
- **三个 verify area**：`agent-card-seen` / `aisessions-run-indicator` 只测 runtime 格式正则；`overview-timeline` 只播一条 report。

## Requirements

**R1 新增 `phaseSince` 字段，不动 `activeSince` 语义。**
`agentstatus.AgentStatus` 加 `PhaseSince int64`（json `phaseSince,omitempty`）：

- 同一 source 上一条与之 `state`、`phase`、`toolName` **三者全等** → 沿用上一条 `PhaseSince`；
- 任一不同（或首条报告）→ `PhaseSince = report.ReportedAt`。

为什么必须用新字段而不是直接改 `activeSince`：
Overview 时间线用 `activeSince < to`（`to = min(session.updatedAt, now)`）作为切两段的前置条件
（`overview-timeline-model.ts:304`）。per-tool 重置后 `activeSince` 常常晚于 `session.updatedAt`，
条件不成立 → 时间线从「unknown 历史段 + 当前色段」塌成一整段，真机肉眼可见回归。

**R2 前端 runtime 改读 `phaseSince ?? activeSince ?? updatedAt`**，两处入口：
`agent-status-chip-view.ts` 的 `runtimeStart()`、`session-run-badge-view.ts` 的内联表达式。

**R3 类型再生**：`frontend/types/gotypes.d.ts` 由 `task generate` 重新生成，不手改。

## 非目标

- 不改 `sameStatus` 的比较字段集合。
- 不改 read/unread 判定与 ack 通道。
- 不给 codex 补 toolName（codex 的 batch/shell hook 只传 state+phase；本次对 codex 的结果是 phase 级归零）。
- 不动 Overview 时间线渲染逻辑、不加「总时长也显示」的 ui。

## 验收判据

1. `go test ./pkg/agentstatus` → ok，且新增用例覆盖（已命名为 `TestPhaseSinceResetsOnPhaseOrToolChange`）：
   - 同 state + 同 phase + 同 toolName 连续上报 → `PhaseSince` 不变、`ActiveSince` 不变；
   - 同 state + 换 toolName → `PhaseSince` 变新、`ActiveSince` 不变；
   - 同 state + phase 由 `tool` 变 `thinking` → `PhaseSince` 变新、`ActiveSince` 不变。
2. `npx vitest run frontend/app/agent-status` → 全绿。
3. `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=47`（基线不劣化）。
4. `node scripts/verify/index.mjs` 中 `agent-card-seen`、`aisessions-run-indicator`、`overview-timeline` 三 area 为绿。
5. 真机手工：pi/claude 会话换工具时徽章归零；`Tool: B` 期间数字单调增长；Overview 时间线条仍两段。

## 风险

- 徽章会频繁归零，短工具闪 `1s` / `3s`。属预期副作用；如需并存总量，后续塞 tooltip（不在本次范围）。
- `phaseSince` 是新增可选字段：旧 renderer 读不到时回落 `activeSince`，不会空显示。
