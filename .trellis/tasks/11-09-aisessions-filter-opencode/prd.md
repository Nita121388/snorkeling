# AISessions 筛选栏支持 OpenCode 来源

## 背景与问题

后端 `pkg/aisessions/provider_opencode.go` 已实现 OpenCode 会话扫描（`SourceOpenCode = "opencode"`），前端类型 `SourceFilter`（`frontend/app/view/aisessions/types.ts`）与 `SourceValues`（`filter-presets.ts`）也都已包含 `"opencode"`。

但筛选栏的 agent 来源段直接 `CHAT_SOURCES.map(...)` 渲染，而 `frontend/app/view/aisessions/sources.tsx` 的 `CHAT_SOURCES` 写死只有 pi / codex / claude 三项——**OpenCode 会话只能混在「All」里，无法单独筛选**。

`chatSourcesForAvailability()` 的动态合并路径救不了它：它只被 chat-composer / session-detail 使用，且数据来自 `/api/aisessions-chat` 的 `AvailableProviders()`，其中 opencode 未注册为 GUI-chat provider，永远不会上报。

## 需求

1. `CHAT_SOURCES` 增加 `{ id: "opencode", label: "OpenCode", dotClass: "bg-source-opencode" }`。
2. `frontend/tailwindsetup.css` 增加 `--color-source-opencode` 色变量（取 OpenCode 品牌色 `#e0b956`，与 `agent-logo.tsx` 中 OpencodeLogo 的 iconColor 一致）。
3. 筛选栏图标无需额外改动：`useChatSourceIcons()` → `getAgentIcon()` → `getAgentLogoByProvider("opencode")` 已有 OpencodeLogo 分支，加入 CHAT_SOURCES 后自动生效。

## 验收标准（判据）

- `grep "opencode" frontend/app/view/aisessions/sources.tsx` 输出包含 CHAT_SOURCES 条目。
- `grep "source-opencode" frontend/tailwindsetup.css` 有 `--color-source-opencode` 定义。
- `SourceFilter` 类型不变（已含 opencode）；filter-presets 序列化/反序列化对 `"opencode"` 值通过（现有 `SourceValues` 已覆盖，跑现有测试确认不回归）。
- `sources.test.tsx` 相关测试与 filter-presets 测试全部通过。

## 范围外

- OpenCode GUI-chat provider 注册（发消息入口，属另一子任务）。
- 筛选栏动态 availability 合并改造。
