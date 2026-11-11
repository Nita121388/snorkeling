# PRD：Agent 卡片属性 — 新增范围三选一 + 表单美化 + 外部操作支持

> 状态：planning（原型已确认：`design/prototypes/agent/property-add-scope/`）

## Goal

把 agent 卡片的「新增属性」从「隐含两档范围 + 一行五控件」升级为：

1. **范围显式三选一**：仅此会话（默认）/ 仅此 Agent（pi、codex…按 `source`）/ 所有会话（全局模板）；
2. **控件重做为浮层面板**：图标输入框 + 自定义类型下拉 + 范围 radio 组 + Cancel/Add（Enter/Esc、重名与空名行内报错）；
3. **外部操作同权**：`wsh agent card set`（`--prop` / `--prop-scope`）与 MCP `snorkeling_agent_card_set` 可指定同一套 scope；
   读取侧 `agent card get` 返回 scope 过滤后的属性定义（含 scope），外部 Agent 能看见「这个属性属于谁」。

范围语义（唯一真相）：

| scope（UI） | schema `Scope` 值 | 会话可见性 | 值写入 |
|---|---|---|---|
| 仅此会话 | 不写模板 | 仅当前会话 | 当前会话 |
| 仅此 Agent | `agent:<source>`（如 `agent:pi`） | 该 source 的全部会话 | 当前会话 |
| 所有会话 | `""`（全局） | 全部会话 | 当前会话 |

## 背景（代码事实，已核对 2026-11-11）

| 事实 | 位置 |
|---|---|
| 表单当前是 input + native select + `Save to template` 复选框（**默认勾选 true**）+ Add/✕ | `frontend/app/view/aisessions/property/property-list.tsx` `AddPropertyForm` |
| 提交语义：属性值总写当前会话；勾选时**同时** upsert 全局模板 | `frontend/app/element/info-card/session-note-section.tsx` `addProperty` |
| `PropertyDef.scope` 类型已预留 `"session" \| "agent"`，但全部写 `"session"`、无消费者 | `property-model.ts:76` |
| 模板定义类型无 scope 字段 | `pkg/wconfig/settingsconfig.go:82` `AgentPropertyDefType` |
| 模板合并只按 key，无 scope 过滤 | `property-model.ts` `toPropertyDefs()` |
| 外部写路径唯一：`wsh agent card set` → `AgentCardSetRequest` → `agentdata` `session_prop.update` → `ApplyAIProperties`（**不写模板**） | `cmd/wsh/cmd/wshcmd-agent-card.go`, `pkg/agentcontrol/card.go`, `pkg/agentdata/patch.go` |
| MCP 写工具 props 只有 `{type,value,name}` | `pkg/agentmcp/tools.go:301` |
| 读侧 `agent card get` 不返回属性定义/scope | `pkg/wshrpc/wshrpctypes.go:746` `AgentCardResult` |
| 会话的 Agent 身份 = `summary.source`（`pi` / `codex` / `opencode`…），**不是** `origin`（origin 是扫描来源/机器） | `pkg/aisessions/provider_pi.go:16` `SourcePi`; `types.go:67` Origin 注释 |

## Requirements

- **R1 数据模型**：`AgentPropertyDefType` 增加 `Scope string`（`""`=全局 / `agent:<source>`），Go 与前端的
  `gotypes.d.ts` 同步；缺省空 = 全局，**旧数据零迁移**。
- **R2 合并过滤**：`toPropertyDefs(summary, schema)` 只并入 `Scope === "" || Scope === "agent:" + summary.source` 的模板项；
  其它 Agent 的模板项不出现。`PropertyDef.scope` 升级为 `"session" | "agent" | "global"`（模板项按 Scope 映射）。
- **R3 表单重做**：`+ Add property` 打开浮层面板（复用 `PropertyValuePopover` portal 模式）：
  名字 input（类名保持可测）、自定义类型下拉（9 种 `CreatableTypes`，图标 + ✓）、
  **范围三选一**（默认「仅此会话」，Agent 项文案带当前 `summary.source`）、Cancel/Add、
  Enter 提交 / Esc 关闭、`Name is required` / `Property already exists` 行内错误。
  删除 `Save to template` 复选框。
- **R4 提交语义**：`onAddProperty(key, type, scope)`；三种范围都写当前会话初值；
  `agent` / `global` 额外 upsert 模板（`Scope = "agent:<source>"` / `""`）。
  detail 模式与 agent 卡片模式共用同一浮层。
- **R5 外部写**：`AgentCardPropPatch` 与 `agentdata.PropPatch` 增加 `Scope string`
  （`session|agent|all`，空=session）；`session_prop.update` 携带 scope（dry-run 报告可见）；
  真实写入成功后，`agent`/`all` 的 prop 由 `agentcontrol.SetAgentCard` 以
  `wconfig.SetBaseConfigValue` upsert `agent:propertyschema` 并 `BroadcastConfigUpdate`。
  `agent` 的 schema scope 值 = `agent:<目标会话的 provider>`。
- **R6 外部 CLI**：`wsh agent card set` 增加 `--prop-scope <session|agent|all>`（本次调用所有 `--prop` 生效，默认 session）；
  非法值报错退出；不传时行为与今天逐字节一致（不写模板）。
- **R7 外部 MCP**：`snorkeling_agent_card_set` 的 props 条目支持可选 `scope`（`session|agent|all`），
  默认 session；工具描述更新。
- **R8 外部读**：`AgentCardResult` 增加 `Schema []AgentPropertyDefType`（已按会话 source 过滤的模板项，
  保留 `Scope` 原值），`agent card get` 文本输出打印 `schema:` 段（key/type/scope）。
- **R9 安全**：内置/reserved key 的 scope 写入同样被拒（`isReservedSessionPropKey` 先于 scope 处理）；
  非法 scope 一律报错（不允许静默降级成 session）。
- **R10 兼容**：`AddPropertyForm` 之外的 `PropertyList` 行为（行渲染 / 标签浮层 / note / md 预览属性卡）不变；
  md 预览属性卡不传 schema，不受 R2 影响。

## Non-goals

- 不做既有属性的「改范围」入口（Property menu → Scope，第二期）；
- 不做模板管理界面（重命名/删除模板项仍走 settings.json）；
- 不改 `Tags` / `ListTags` / 标签浮层（`11-06-agent-card-tag-picker` 地盘）；
- 不做跨机器 origin 维度的 scope（v1 scope 只按 `source`，与机器无关）；
- 不改 `session_note.update` / `common_text.update` / `tag.rename` 等其它 patch op。

## Acceptance Criteria

- [ ] **AC1** `npx vitest run frontend/app/view/aisessions/property` → 全绿；覆盖：范围三选一默认值与切换、
      提交回调收到正确 scope、类型下拉、Enter/Esc、重名/空名错误、浮层关闭。
- [ ] **AC2** `npx vitest run frontend/app/element/info-card` → 全绿（`addProperty` 三种 scope 的写入参数：
      session 不写模板；agent 写 `agent:<source>`；global 写 `""`）。
- [ ] **AC3** `npx vitest run frontend/app/view/aisessions` → 全绿。
- [ ] **AC4** Go：`go test ./pkg/agentcontrol ./pkg/agentdata ./pkg/wshclient/... 2>/dev/null` 相关包全绿；
      新增用例覆盖：session_prop.update 携带 scope 的 dry-run 报告、`agent`/`all` 成功写入后
      `agent:propertyschema` 精确 upsert（不覆盖无关项）、非法 scope 报错、reserved key 跳过。
- [ ] **AC5** CLI：`wsh agent card set --help` 含 `--prop-scope`；非法 scope 返回非零并给出明确错误；
      不传 scope 时 dry-run 报告与改动前一致（无 schema 段）。
- [ ] **AC6** MCP：`snorkeling_agent_card_set` 工具 schema 的 props 条目含 `scope` 枚举；单测断言。
- [ ] **AC7** `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=47`（基线 47）。
- [ ] **AC8** 真机 CDP：hover 卡 → `+ Add property` → 浮层可见（名字/类型/3 个 scope/按钮）；三种 scope 各建一个属性后，
      卡片行出现、`agent` 范围的属性在另一个 pi 会话可见、codex 会话不可见；截图 + `report.json` 落 `verify-runs/agent-property-scope/`。
- [ ] **AC9** 外部端到端：`wsh agent card set <pi 会话> --prop 优先级=select:P1 --prop-scope agent --dry-run` 报告含 scope；
      `--yes --expected-hash` 后 `settings.json` 的 `agent:propertyschema` 出现 `{key:"优先级", scope:"agent:pi"}`。

## 判据（loop 门链用，命令 → 期望输出）

| # | 命令 | 期望 |
|---|---|---|
| 1 | `npx vitest run frontend/app/view/aisessions/property` | `passed` |
| 2 | `npx vitest run frontend/app/element/info-card` | `passed` |
| 3 | `go test ./pkg/agentcontrol`（在 `scripts/use-local-env.ps1` 环境内） | `ok` |
| 4 | `go test ./pkg/agentdata` | `ok` |
| 5 | `npx tsc --noEmit -p tsconfig.json \| grep -c "error TS"` | `<=47` |

## G1 签字

> **Confirmed: 2026-11-11 @nita**
