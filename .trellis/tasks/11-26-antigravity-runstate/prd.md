# Antigravity 状态接管：声明式 status 轮询与列表运行态展示

## Goal

外部声明式 provider 会话（在 IDE 里跑、没有 Snorkeling 块）的**运行状态**在 AI Sessions 列表可见。数据源是 `conversation_summaries.db` 的 `status` 列（实测：运行中 `CASCADE_RUN_STATUS_RUNNING`，结束回 `CASCADE_RUN_STATUS_IDLE`），沿用既有扫描链路，不引入新轮询循环、不动 AgentStatusStore（那是块内 hook 接管通道）。

## 背景（本机实测，2026-11-26）

- agentstatus hook targets 只有 codex/claude/opencode/pi；Antigravity CLI 无 hooks 机制（settings 只有 colorScheme/permissions/trustedWorkspaces）——hook 式接管不可行。
- 列表 run 徽章按 blockId 键控（AgentStatusStore），外部会话没有 block，状态无处显示。
- `conversation_summaries.db` 现成字段：`status`（RUNNING/IDLE）、`last_modified_time`、`not_fully_idle`。
- 运行中的会话其 `conversations/<uuid>.db` 持续写入 → mtime 变 → `refreshChangedSummaries` 会重解析 → 状态天然跟随既有增量刷新链路。

## Requirements

- R1 declarative provider columns 增加可选 `status` 字段映射；antigravity 内置默认条目同步补 `status: "status"`。
- R2 状态归一化**纯函数**（可单测）：值含 `RUNNING`（大小写不敏感）→ `"running"`；`IDLE`/空 → `""`；未知值记 debug 日志留空。
- R3 **陈旧运行保护**：`RUNNING` 且 `last_modified_time` 距归一化时刻超过 TTL（默认 5 分钟，测试可注入时钟）→ 视为陈旧，归一化为 `""`（防 Antigravity 崩溃后会话永远显示 running）。
- R4 `SessionSummary` 增 `RunState string \`json:"runState,omitempty"\``；索引库 `ai_sessions` 加列 `run_state TEXT NOT NULL DEFAULT ''`（走 `ensureAISessionColumns` 迁移模式 + DDL 同步 + 列变更时 `invalidateSummaryScanMarker`）。
- R5 前端列表行运行指示：`summary.runState === "running"` 时行内显示运行态（复用既有 RunningDot/run 徽章视觉家族，不建第三份状态映射）；与既有「块内运行」（`useSessionsRunning`，blockId 投影）在**一个纯函数**里合流，可单测。
- R6 不动：AgentStatusStore / agentstatus hooks / thinking/tool phase（db 只有粗粒度 RUNNING）。
- R7 遵守 aisessions-scan-contract：不新增扫描入口；状态读取发生在 provider 的 List/ParseSummary 既有查询里（同一 SELECT 多取一列）。

### Out of scope（后续独立任务）

- thinking / tool 阶段粒度状态（db 无此信息）
- Overview 看板卡 / Tab 悬浮卡的外部会话运行态
- OS 通知（agent:osnotify）对外部会话的接入
- 块内跑 antigravity 的 hook 式接管（等 Antigravity 官方 hook API）

## Acceptance Criteria

- [ ] fixture db：`status='CASCADE_RUN_STATUS_RUNNING'` + 新鲜 `last_modified_time` → `List()` 返回 `runState="running"`；同值 + 陈旧时间（>TTL）→ `runState=""`；`IDLE`/空 → `runState=""`；未知值 → `runState=""` 且不 panic。（Go 单测）
- [ ] 索引迁移：带旧 schema 的库打开后自动加 `run_state` 列，重扫后 `SELECT run_state FROM ai_sessions WHERE source='antigravity'` 返回归一化值。（Go 单测）
- [ ] 前端：合流纯函数单测（块内 running 优先/外部 running 兜底/两者皆无不显示）；vitest 全绿。
- [ ] 真机验证（**移机待跑**，本机性能不足 2026-11-26 用户指示）：fixture 造 RUNNING 会话 → 列表行出现运行指示。验证台脚本就绪（--dry 本机可过）。
- [ ] `go test ./pkg/aisessions ./pkg/wconfig` 全绿；vitest aisessions 目录全绿；tsc 新增 0。
