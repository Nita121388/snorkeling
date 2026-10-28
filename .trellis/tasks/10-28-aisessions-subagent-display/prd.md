# aisessions 子代理在详情中显示（非 pi provider）

## Goal

用户反馈：会话详情"只看到工具调用，没看到子代理的调用"。要让子代理派发在详情里可见，且与工具行区分。

## 根因

- 后端 `ExtractSubagentCalls` 只解析 pi 格式 JSONL，且只认 `toolName == "subagent"`。
- Claude Code 的子代理工具叫 `Task`、Codex 叫 `SubagentStart` 等，全部匹配不到。
- 更关键：Claude/Codex/OpenCode provider 构造 ToolCall 时**不设 ItemKey**，前端 `subagentMatchesByKey.get(item.toolCall.itemKey ?? "")` 永远空 key → 即使后端匹配也链接不上，降级成普通工具行。

## Requirements

- 后端：`SubagentFold` 按 `summary.Source` 分派到对应 provider 的子代理调用提取器；至少覆盖 pi / claude / codex / opencode 的派发工具名与参数形状（`agent`/`subagent_type`、`task`/`prompt`/`description`）。
- 后端：非 pi provider 的子代理 ToolCall 也带稳定 ItemKey（claude `tool_use.id` / codex `call_id` / opencode item `id`），使前端能链接。
- 前端：`subagentMatchFor` 与后端提取使用同一套工具名别名（共享常量），不再硬编码 `=== "subagent"`。
- 前端：匹配失败（missing）时仍渲染为可辨识的子代理卡，而不是静默退化。

## Acceptance Criteria

- [ ] pi 会话子代理行为不回归（现有 `subagent_fold_test.go` 通过）。
- [ ] claude / codex / opencode 的子代理派发能被提取并匹配（新增单测）。
- [ ] 非 pi ToolCall 带 itemKey，前端按 itemKey 命中。
- [ ] 工具名别名集中在一处，前后端一致。
- [ ] 未匹配的子代理派发仍以子代理样式呈现（不静默变成普通工具）。
