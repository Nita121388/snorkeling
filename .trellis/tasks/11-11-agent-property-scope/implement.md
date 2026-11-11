# 执行计划：Agent 属性 scope

## 0. 准入

- [ ] loop 工作项 `F-1111-agent-property-scope`（type=feature，门：g1/g2/g5；g7 收尾由人签）
- [ ] 基线（2026-11-11 记录）
  - `npx vitest run frontend/app/view/aisessions/property` = 3 files / 34 passed
  - `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` = 47
- [ ] 原型已确认：`design/prototypes/agent/property-add-scope/`（▲）

## 1. 后端（先模型后通道，Go 优先）

### Step 1.1 schema 类型加 Scope
- 改 `pkg/wconfig/settingsconfig.go` `AgentPropertyDefType`：`Scope string \`json:"scope,omitempty"\``
- 改 `frontend/types/gotypes.d.ts` `AgentPropertyDefType` 同步
- 验证：`go build ./pkg/wconfig`

### Step 1.2 patch/请求 DTO 加 Scope
- 改 `pkg/agentdata/patch.go` `PropPatch` + `sessionPropSuggestions` 透传
- 改 `pkg/wshrpc/wshrpctypes.go` `AgentCardPropPatch`
- 改 `pkg/agentcontrol/card.go` 请求→op 转换处透传
- 验证：`go build ./pkg/...`

### Step 1.3 agentcontrol schema upsert（agent/all）
- `pkg/agentcontrol/card.go`（或新文件 `card_schema.go`）：
  - `scopeForSchema(sessionKey string, scope string) (string, bool)`：session→("",false)；
    agent→("agent:"+providerOf(key),true)；all→("",true)；非法→error
  - `upsertPropertySchema(defs []wconfig.AgentPropertyDefType, key, name, type, scope) []…`
  - 真实 apply 成功后调用 `wconfig.SetBaseConfigValue` + `BroadcastConfigUpdate`
  - dry-run：`Messages` 加 "scope would update agent:propertyschema (...)"
- 新增 `pkg/agentcontrol/card_schema_test.go`：upsert 不覆盖无关项 / agent scope 推导 / 非法 scope / 回滚不写

### Step 1.4 读侧
- `AgentCardResult` 加 `Schema []wconfig.AgentPropertyDefType`
- `GetAgentCard` 过滤填充（`scope=="" || scope=="agent:"+source`）
- 验证：`go test ./pkg/agentcontrol`

### Step 1.5 CLI + MCP
- `cmd/wsh/cmd/wshcmd-agent-card.go`：`--prop-scope` flag + 校验 + 写入请求；`card get` 打印 schema 段
- 新增/补 `cmd/wsh/cmd/wshcmd-agent-card_test.go`：合法/非法 scope
- `pkg/agentmcp/tools.go`：props 条目加 `scope` enum；`server_test.go` 断言

## 2. 前端

### Step 2.1 模型
- `property-model.ts`：`PropertyDef.scope: "session"|"agent"|"global"`；
  `toPropertyDefs` 建 schemaByKey 前过滤 scope；模板项 scope 映射
- `property-schema.ts`：`upsertSchemaDef` 接受 `{scope?}`；`SchemaDef` 用新字段
- 单测：`property-model.test.ts`（新增 scope 过滤矩阵）

### Step 2.2 表单浮层（核心 UI）
- `property-list.tsx`：删除 `AddPropertyForm` 内联表单，改为 `PropertyAddPopover`
  - 结构对齐原型：`.pp-*` 命名改为项目习惯（`property-add-popover` 等），SCSS 复用主题变量
  - props：`existingKeys / onSubmit(key,type,scope) / onClose / agentLabel`
  - portal 用 `PropertyValuePopover`（复用定位与钳位）
  - `[hidden]` + `display:flex` 的显式兜底（原型实测坑）
- 改 `property-list.scss`：新浮层样式 + footer 触发器保持 `property-add--inline`
- `onAddProperty` 签名：`(key, type, scope: "session"|"agent"|"global")`
- 单测：`property-list.dom.test.tsx`（默认 session、切换、提交参数、Enter/Esc、错误）

### Step 2.3 接线
- `session-note-section.tsx` `addProperty`：按 scope 写模板（`agent:`+summary.source / `""`）
- 补 `session-note-section.test.tsx` 三 scope 断言
- detail（`property-actions`）与 agent/footer 共用同一个浮层组件

### Step 2.4 文案与 Agent 标签
- 「仅此 Agent（pi）」的 pi 取 `summary.source`，无 source 时隐藏该项？**决策**：无 source 时仍显示「仅此 Agent」但禁用并提示（避免写入 `agent:` 空值）

## 3. 验证与收尾

- [ ] `npx vitest run frontend/app/view/aisessions/property` → passed
- [ ] `npx vitest run frontend/app/element/info-card` → passed
- [ ] `npx vitest run frontend/app/view/aisessions` → passed
- [ ] `go test ./pkg/agentcontrol ./pkg/agentdata`（本地 env） → ok
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=47`
- [ ] 真机 CDP 验证（verify-runs/agent-property-scope/：截图 + report.json）
- [ ] 外部端到端（`wsh agent card set --prop-scope`）→ settings.json 出现 `scope:"agent:pi"`
- [ ] 更新 `docs/project/agent-control-surface.md`（新增 `--prop-scope` 与 schema 读）
- [ ] 更新 `docs/project/agent-data-patch.md`（`PropPatch.scope`）
- [ ] 更新原型 README 状态 ▲ → ◐/●
- [ ] archive 任务

## 4. 回滚点

- 每个 Step 独立可 revert；Step 1.1/2.1（字段）先落，纯增量。
- 若浮层回归严重：把 `PropertyAddPopover` 的开关切回旧 `AddPropertyForm`（保留组件到确认后删除）。
