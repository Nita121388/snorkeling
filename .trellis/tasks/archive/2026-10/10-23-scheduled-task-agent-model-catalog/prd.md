# 定时计划：Agent/模型目录（Agent Catalog）基础能力

## Goal

让「定时计划」编辑器在选择 agent 后，模型下拉框显示该 agent 实际配置的模型列表；
并把「agent → 可用模型」做成一份**唯一的、后端可达的目录能力**，为将来
「一个 agent 创建其他 agent 的 Block 去执行/操作」提供同一套解析入口。

## 现状问题

1. `frontend/app/view/scheduledtasks/scheduledtasks-view.tsx` 硬编码 `AgentProfiles`（5 项）和
   `PiModels`（4 项）；非 pi agent 只会显示一个单值 option，无法选模型。
2. 用户在设置里配置的 `agent:profiles`（`cmd/args/model/modelflag/env`）与编辑器里的列表完全脱节；
   新增自定义 agent 不会出现在定时计划里。
3. `pkg/scheduler/runner.go` 自己再解析一遍 `agent:profiles`，与前端是两套事实来源。
4. 项目已有 `agent-launch.ts:getAgentProfileOptions`，但它是「按本机是否检测到命令」过滤的启动器视图，
   且只返回 name/label/cmd，不含模型列表，不能直接复用。

## Requirements

### R1. 目录即事实来源
- 新增后端目录（`pkg/agentcatalog`），合并 **内置 agent 默认值** + **`agent:profiles` 用户配置**，
  输出：profile 名、显示名、cmd、modelflag、默认模型、模型列表（id/label/provider/default）。
- 模型列表解析优先级（高 → 低）：
  1. `agent:profiles.<name>.models`（用户显式配置，最权威）
  2. **各 agent 本地配置 discovery**（pi `models.json`、codex `models_cache.json`、claude `settings.json` env、opencode `opencode.jsonc`、gemini `settings.json`）
  3. 已注册 `ModelResolver`（后续慢速 CLI 探测扩展点）
  4. `agent:profiles.<name>.model` 单值（老配置兜底，作为唯一模型）
  5. 空列表 → 前端退化为自由输入（不阻断保存）
- **禁止内置静态模型表**：不得凭空写死模型 ID；看不到配置就显示空列表。
- 去重按 model id；`label` 缺省用 id；默认模型取 `models[].default`，否则 `profile.model`，否则第一项。
- 目录只读配置，不探测外部 CLI、不写用户数据。

### R2. RPC 暴露
- 新增 `AgentProfileListCommand` → 返回完整 profile 列表（含 models）。
- 该 RPC 是给 **UI 和 agent 共用**的入口，后续 Block 创建直接消费同一结构，不再二次解析配置。

### R3. 定时计划 UI 消费目录
- agent 下拉来自目录（用户新增的 custom profile 也能出现）。
- 选择 agent 后，模型下拉立即切到该 agent 的模型列表。
- 切换 agent 时把 model 重置为该 agent 的默认模型。
- 编辑已有任务且其 model 不在列表时，保留一个 `<option>` 显示当前值，避免静默丢配置。
- 删除 `scheduledtasks-view.tsx` 中的硬编码数组。
- 编辑器必须是 **app 级大弹窗**（`FlexiModal`，portal 到 `#main`），不再局限在 Block 内。

### R4. 调度执行侧对齐
- `pkg/scheduler/runner.go` 使用同一目录解析 profile / 默认模型 / modelflag。
- 任务未指定 model 时使用 profile 默认模型；指定但不在列表时仍按原值执行（只告警/不阻断）。

### R5. 面向 agent 的基础能力（本期落地最小面）
- `wsh agent list [--json]` 输出目录，供任意 agent 发现 profile + 模型。
- `pkg/agentcap` 指南补充该命令（让 agent 能发现）。
- **不在本期实现** `AgentBlockCreate`，但在 design 中固定其契约字段，确保将来无需改目录结构。

## Non-Goals

- 不实现「按 vendor（cc-switch）动态拉取模型」的运行时探测；只在目录里预留 resolver 扩展点。
- 不改动 cc-switch vendor 选择器逻辑，也不改 New-Agent 启动窗口的 vendor 交互（后续可切换为共用目录）。
- 不做 OS 级定时（launchd/schtasks）。

## Acceptance Criteria

- [ ] 新建定时任务：选 `codex` 只看到 codex 配置的模型；选 `pi` 看到 pi 的模型；切换 agent 模型自动落到默认项。
- [ ] 在设置里给某 agent 增加 `models` 后，重新打开定时任务编辑器即可看到新模型（无需改代码）。
- [ ] 在设置里新增一个 custom profile（如 `myagent`），定时计划 agent 下拉可见。
- [ ] 老任务保留原 model 值可正常显示与保存。
- [ ] `wsh agent list --json` 输出与 UI 下拉同源。
- [ ] `go test ./pkg/agentcatalog/... ./pkg/scheduler/...` 通过；前端相关 vitest 通过；`tsc` 无新增错误。
- [ ] 无硬编码 agent / 模型数组残留在定时计划视图中。