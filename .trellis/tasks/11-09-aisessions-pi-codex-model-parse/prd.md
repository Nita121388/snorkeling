# pi/codex 会话模型解析：Agent 卡片不再显示未指定

## 背景

Agent 卡片（`AgentHoverCard` / `TabMoreAgentCard` / `AgentCardModal`）副标题的模型位
恒为「未指定」。11-04 任务 `11-04-fix-agent-card-model-vendor` 已把前端解析链
（`agent-identity.ts`）、运行时 store（`agent-runtime-metadata-store.ts`）与后端
`LiveSessionState` 磁盘兜底（`pkg/service/aisessionsservice/chatcontrol.go`）做好，
但其 PRD 把 pi 与 codex 记成「transcripts 不暴露 Model」，这个结论是错的。

## 实证（本机真实数据）

| provider | 会话里的模型信息 | 现状解析 |
| --- | --- | --- |
| claude | `message.model`（实测 `glm-5.2`） | ✅ `provider_claude.go:119` |
| opencode | `modelID` + `providerID`（实测 `mimo-v2.6-flash-free`） | ✅ `provider_opencode.go:497` |
| pi | 每条 assistant `message.model` + 会话头 `model_change.modelId` | ❌ 0 处 |
| codex | 每轮 `turn_context.payload.model` + 会话头 `session_meta.payload.model_provider` | ❌ 0 处 |

`pkg/aisessions/paths.go:148-168` 注册的正是这 4 个 provider。所以「未指定」是解析缺失，
不是上游不支持。

## 目标

`pkg/aisessions` 的 pi / codex provider 在解析消息时填充 `Message.Model`，使
`LiveSessionState` 的磁盘兜底（扫 `detail.Messages` 里最后一个非空 `Model`）能取到真实模型，
从而下列三个显示面都显示真实模型：

- `AgentHoverCard`（悬浮卡副标题）
- `TabMoreAgentCard`（Tab 更多下拉迷你行，读 `agent:requestedmodel`，另有独立入口）
- `AgentCardModal`（放大弹窗，复用悬浮卡）

## 非目标

- **不补 gemini provider**：`pkg/aisessions` 没有 gemini session provider（只有启动器能拉起），
  模型无从读取，属独立能力缺失，另开包。
- **不改前端**：前端回退链已经正确，`resolveAgentModel` 优先级（live → requested → session）不动。
- **不改 vendor 名来源**：`agent:*vendorname` 仍由 cc-switch 启动器写入；非启动器拉起的 agent
  继续回退到 provider label（`Pi` / `Codex`），这不是「未指定」。
- **不做会话级 tail-scan 优化**：`LiveSessionState` 仍走 `manager.Load`，按 block 去重。

## 验收判据（必须有数字）

1. `go test ./pkg/aisessions/ -run 'TestPiAssistantMessageModel|TestPiModelChangeFallback|TestCodexTurnContextModel' -v`
   → 3 个测试全部 PASS。
2. 真实数据校验：用真实 `~/.pi/agent/sessions/.../*.jsonl` 与
   `~/.codex/archived_sessions/rollout-*.jsonl` 各解析一条会话，
   打印「assistant 消息总数 / 带 Model 的条数」两行数字，期望两者相等且 Model 非 `未指定`
   （pi 期望 `deepseek-v4.1-flash`，codex 期望 `gpt-5.4`）。
3. 回归：`go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/...` 全绿，FAIL 数 0。
4. `gofmt -l` 对两个改动文件输出为空。

## 风险

- codex 的模型挂在 `turn_context` 上（跨行状态），不是每条消息自带；`LoadMessageDelta`
  走的是无状态单行解析器，delta 出的消息可能没有 Model。delta 只用于详情尾部流式追加，
  首次全量 `Load` 已带 Model，影响可接受，在 design.md 里记明。
