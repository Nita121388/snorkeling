# Implement: Agent Catalog（定时计划 agent/模型目录）

## 前置

- 任务：`10-23-scheduled-task-agent-model-catalog`
- 涉及包：`snorkeling-docs`（pkg + frontend + cmd/wsh）
- 先读：`pkg/wconfig/settingsconfig.go`、`pkg/scheduler/runner.go`、`pkg/agentcap/agentcap.go`、
  `frontend/app/view/scheduledtasks/*`、`frontend/app/workspace/agent-launch.ts`、`frontend/app/workspace/ccswitch-vendors.ts`、
  `cmd/wsh/cmd/wshcmd-createblock.go`
- 工具链：`npm run setup` 后经 `scripts/use-local-env.ps1` 执行 go/vitest

## M1 配置字段 + 目录包

- [x] `pkg/wconfig/settingsconfig.go`
  - 新增 `AgentModelConfigType`
  - `AgentProfileConfigType` 增 `Label`、`Models`
- [x] `pkg/agentcatalog/catalog.go`（新）
  - `ModelInfo` / `ProfileInfo` / `List()` / `Resolve(name)` / `defaultModelCatalog`
  - 解析优先级：config.models → builtin models → profile.model → 空
  - `model` 不在 models 时补入；`default` 标记归一化
  - 预留 `ModelResolver` 扩展点（暂不注册）
- [x] `pkg/agentcatalog/catalog_test.go`
  - 内置兜底 / 配置覆盖 / 合并去重 / default / 单项 / 空
- [x] 验证：`go test ./pkg/agentcatalog/...`

## M2 RPC

- [x] `pkg/wshrpc/wshrpctypes.go` 加 `AgentProfileListCommand`
- [x] `pkg/wshrpc/wshrpctypes_const.go` 加 `Command_AgentProfileList`
- [x] `pkg/wshrpc/wshserver/agentprofile.go`（新）实现，薄封装 `agentcatalog.List()`
- [x] 生成：`go run cmd/generatets/main-generatets.go`、`go run cmd/generateschema/main-generateschema.go`
- [x] 验证：`go build ./pkg/wshrpc/...`；`frontend/types/gotypes.d.ts` 出现 `ProfileInfo`

## M3 执行侧对齐

- [x] `pkg/scheduler/runner.go`
  - 删除重复的 `resolveAgentProfile` 内置表，改调 `agentcatalog.Resolve`
  - 空 model 走 `DefaultModel`；非列表值仅告警
  - 保留 `task.AgentCmd` 覆盖
- [x] `pkg/scheduler/runner_test.go` 补默认模型/覆盖用例
- [x] 验证：`go test ./pkg/scheduler/...`

## M4 前端目录加载

- [x] `frontend/app/workspace/agent-catalog.ts`（新）
  - `loadAgentCatalog(force?)` / `invalidateAgentCatalog()`（Promise 缓存 + 60s TTL）
  - `pickDefaultModel` / `modelOptionsFor` 纯函数
- [x] `frontend/app/view/scheduledtasks/scheduledtasks-model.ts`
  - env 增加 `AgentProfileListCommand`
  - `agentCatalogAtom` / `catalogLoadingAtom`
  - `refreshCatalog()`；`openCreate` 用目录默认 profile + 默认模型
- [x] `scheduledtasks-model.test.ts`（新/补）覆盖纯函数
- [x] 验证：`npx vitest run frontend/app/view/scheduledtasks frontend/app/workspace/agent-catalog.test.ts`

## M5 编辑器 UI

- [x] `frontend/app/view/scheduledtasks/scheduledtasks-view.tsx`
  - 删除 `AgentProfiles` / `PiModels`
  - agent 下拉 = 目录；切换时重置 model 为默认
  - model 下拉 = 该 agent 的 models；空列表退化 input
  - 当前值不在列表时补 option
  - 表格 Agent/Model 列显示 label（找不到回退原值）
- [x] 视觉核对（Electron CDP）：新建/编辑、切 agent、custom profile、老任务
- [x] 验证：`npx tsc --noEmit`（或项目等价 typecheck）无新增错误

## M6 agent 侧收发口

- [x] `cmd/wsh/cmd/wshcmd-agent.go`（新）：`wsh agent list [--json]`
- [x] 注册到 root cmd；`go build ./cmd/wsh/...`
- [x] `pkg/agentcap/agentcap.go` 指南补 `wsh agent list` 段
- [x] 手工：`wsh agent list --json` 与 UI 下拉同源核对

## M8 真实模型来源 discovery（替代内置静态表）

- [x] `research/agent-model-sources.md` 记录各 agent 实测来源
- [x] `pkg/agentcatalog/discovery.go`（新）
  - pi: `$PI_CODING_AGENT_DIR/models.json` + `settings.json` 默认 provider/model
  - codex: `$CODEX_HOME/models_cache.json`（visibility=list）+ `config.toml` 顶层 model
  - claude: `$CLAUDE_CONFIG_DIR/settings.json` env `ANTHROPIC_*MODEL`
  - opencode: `$OPENCODE_HOME/opencode.json[c]`（JSONC：注释/尾逗号）
  - gemini: `$GEMINI_CONFIG_DIR/settings.json`
  - 只读文件、不跑子进程、不写用户数据
- [x] `pkg/agentcatalog/catalog.go` 删除 `builtinModelCatalogs`，解析改为 config → discovery → resolver → profile.model
- [x] `pkg/agentcatalog/discovery_test.go`：五类来源 + JSONC + config 覆盖 + source 标记
- [x] 真实数据核对：pi 13 个模型（默认 deepseek-v4.1-flash）、codex 6 个（默认 gpt-5.6-sol）、claude 1 个（glm-5.3）、opencode/gemini 空
- [x] `go build ./...` + `go vet ./pkg/agentcatalog/...` + vitest + tsc（改动文件）通过

## M7 收尾

- [x] `go test ./pkg/agentcatalog/... ./pkg/scheduler/...`
- [x] 相关 vitest + typecheck
- [x] `python .trellis/scripts/task.py validate <dir>` 确认 jsonl 清单
- [x] 更新 `.trellis/spec/snorkeling-docs/backend/index.md`：新增「Agent Catalog 单一事实来源」条目
- [x] `git diff` 自检：确认无其他硬编码 agent/model 列表残留
- [x] commit

## 回滚点

- M1+M2 可独立成立（目录 + RPC），回滚只需删包与接口。
- M5 单 commit 回滚可恢复旧硬编码 UI。
- 风险：`schema/settings.json` 为生成物，回滚时一并还原。

## 不在本期

- `AgentBlockCreateCommand`（仅 design 定契约）
- cc-switch vendor 模型动态拉取
- New-Agent 启动窗口改用目录（后续统一）