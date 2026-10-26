# Implement: AI 提示词按功能区分 + 可配置提示词设置页

## 前置

- 任务：`10-23-ai-prompt-settings`
- 涉及包：`snorkeling-docs`（pkg + frontend）
- 先读：`pkg/aisessions/metagenerate.go`、`pkg/aiusechat/completion.go`、`frontend/app/view/waveconfig/waveai-modes.ts`、`frontend/app/store/session-note-hook.ts`

## M1 后端配置与注册表

- [x] `pkg/wconfig/settingsconfig.go`
  - 新增 `AIPromptConfigType`
  - `FullConfigType` 增加 `AIPrompts map[string]AIPromptConfigType \`json:"aiprompts"\``
  - 单测：`ReadFullConfig` 能读到 `aiprompts.json`（可复用 `settingsconfig_test.go` 的临时目录模式）
- [x] `pkg/aisessions/promptregistry.go`（新）
  - feature 常量、`PromptFeatureMeta`、`ListPromptFeatures`
  - 默认提示词常量（note-tags 迁移原文案；title 新增）
  - `ResolvePrompt` / `ResolveAIMode` / 参数夹取函数
  - 单测 `promptregistry_test.go`：默认、覆盖、追加、空、超长、enabled
- [x] `pkg/aisessions/metagenerate.go`
  - `MetadataGenerateRequest` 增加 `PromptConfig`
  - 使用注册表解析 prompt / mode / maxNoteChars / maxTags
  - 保留现有测试通过（必要时更新）

## M2 标题生成与 RPC

- [x] `pkg/aisessions/titlegenerate.go`（新）
  - `TitleSuggestion` / `TitleGenerateRequest` / `GenerateSessionTitle`
  - `parseTitleResponse`（JSON、去引号、长度夹取）
  - 单测 `titlegenerate_test.go`
- [x] `pkg/service/aisessionsservice/aisessionsservice.go`
  - `AISessionsGenerateTitleRequest/Response`
  - `GenerateTitle`
  - `PromptTemplates`（返回 feature 元信息 + 默认提示词）
  - `GenerateMetadata` 读取 `wconfig` 中的 feature 配置并透传
- [x] 类型生成：更新 `frontend/types/gotypes.d.ts`
- [x] 前端 `frontend/app/store/services.ts` 补 service 包装（若生成流程未包含）

验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/... ./pkg/wconfig/... ./pkg/service/aisessionsservice/..."
```

## M3 AI Prompts 设置页

- [x] `frontend/app/view/waveconfig/aiprompt-model.ts`（新）
  - `PROMPT_FEATURES` 元信息
  - `resolvePromptDraft` / `buildPromptPayload` / `savePromptConfig`
  - `aiprompt-model.test.ts`
- [x] `frontend/app/view/waveconfig/aipromptsettings.tsx`（新）
  - 双栏布局、字段表单、恢复默认、预览、脏状态、防抖保存
  - 窄窗堆叠
- [x] `frontend/app/view/waveconfig/waveconfig-model.ts`
  - `makeConfigFiles()` 注册 `AI Prompts` / `aiprompts.json` / `AIPromptsVisualContent`

验证：

```powershell
npx vitest run frontend/app/view/waveconfig
npx tsc --noEmit -p tsconfig.json
npx eslint frontend/app/view/waveconfig
```

## M4 会话标题 AI 入口

- [x] `frontend/app/store/session-note-hook.ts`
  - `titleSuggestion` 状态、`generateTitle`、`applyTitle`、`dismissTitle`
  - 读取 `resolveMetadataAIMode()` 的可用性判断（复用）
- [x] `frontend/app/element/info-card/session-note-section.tsx`
  - 标题行 wand 按钮 + 建议气泡（Apply / Regenerate / Dismiss）
  - 视觉与 note 建议面板一致
- [x] 前端单测：hook 状态转换（可抽出纯函数测试）

## M5 收尾

- [x] 运行 targeted Go tests + frontend vitest + eslint + tsc
- [ ] Electron UI 静态核对（窄窗、深色/浅色）— 未启动 CDP 实例，留待人工/下次运行核对
- [ ] `detect_changes()` 影响面检查 — 本会话未暴露 GitNexus MCP 工具，已改用 `git diff` 逐文件核对
- [x] 更新 `.trellis/spec/snorkeling-docs/backend/` 新增 `ai-prompt-config-contract.md`
- [ ] 提交（一个 commit，消息：`feat(aisessions): 可配置 AI 提示词与标题生成`）

## 状态

- M1–M4 已实现，M5 验证进行中。
- Go: `go test ./pkg/aisessions/ ./pkg/wconfig/ ./pkg/service/aisessionsservice/` 通过。
- Frontend: 相关 vitest 16 files / 88 tests 通过；eslint 无新增问题；tsc 仅剩仓库既有 baseline 错误。

## 回滚点

- M1 完成后即可独立回滚（无行为变化）
- M2 引入新 RPC，旧前端不受影响
- M3/M4 仅前端，删除 `aiprompts.json` 即恢复默认行为
