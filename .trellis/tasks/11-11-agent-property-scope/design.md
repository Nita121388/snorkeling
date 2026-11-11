# 技术设计：Agent 属性 scope（会话 / Agent / 全局）

## 1. 边界

```
┌─────────────────────────── 前端 ───────────────────────────┐
│ AddPropertyPopover (property-list.tsx)                     │
│   onSubmit(key, type, scope: session|agent|global)         │
│            │                                               │
│ session-note-section.addProperty                           │
│   ① writeSessionProps（值，总是）  ← saveSessionProps      │
│   ② scope!=session → upsertSchemaDef(+scope) → SetConfig   │
│            │                                               │
│ toPropertyDefs(summary, schema)                            │
│   include def if Scope=="" || Scope=="agent:"+summary.source│
└────────────────────────────────────────────────────────────┘

┌─────────────────────────── 外部 ───────────────────────────┐
│ wsh agent card set --prop k=t:v [--prop-scope s]           │
│ MCP snorkeling_agent_card_set {props:{k:{type,value,scope}}}│
│            │                                               │
│ AgentCardSetRequest.Props[k].Scope                         │
│            │                                               │
│ agentcontrol.SetAgentCard                                  │
│   ① agentdata.PatchOperation{session_prop.update, scope}   │
│   ② 成功且 scope∈{agent,all} → wconfig.SetBaseConfigValue  │
│      upsert agent:propertyschema + BroadcastConfigUpdate   │
│            │                                               │
│ agent card get → AgentCardResult.Schema[]（按 source 过滤）│
└────────────────────────────────────────────────────────────┘

settings.json: "agent:propertyschema": [
  {key, name, type, order, scope: "" | "agent:pi"}
]
sessions: summary.props[key] = {value, type, source, updatedAt}   # 值永远 per-session
```

## 2. 契约

### 2.1 scope 编码（唯一）

- schema 侧：`Scope string` —— `""` = 全局；`"agent:<source>"` = 指定 Agent（source ∈ pi/codex/opencode/…）。
- API/CLI/MCP 侧：`Scope string` —— `"session"` / `"agent"` / `"all"`，空值 = `"session"`。
- `agent` → 写 schema 时落 `"agent:" + <目标会话 provider>`；`all` → `""`；`session` → 不写 schema。
- 非法值：CLI/后端显式报错，**不**静默降级（R9）。

### 2.2 合并规则（前端）

```ts
function schemaVisibleTo(def: SchemaDef, source: string): boolean {
    const scope = (def.scope ?? "").trim();
    if (scope === "") return true;
    return scope === `agent:${source}`;
}
```

- `PropertyDef.scope`：`"session"`（session props 行）/ `"global"`（空 Scope 模板项）/ `"agent"`（agent 模板项）。
- key 冲突：现有 `schemaByKey` 只用于补 name/type/options；过滤发生在建索引之前 →
  别的 Agent 的同名模板不会污染本会话（同 key 本会话已有 props 仍按 props 渲染）。

### 2.3 外部写（Go）

`agentdata.PropPatch` + `wshrpc.AgentCardPropPatch` 增加 `Scope string`：
- `sessionPropSuggestions` 透传 `Scope`；`session_prop.update` 的 dry-run 报告带 scope（信息性）。
- `ApplyAIProperties` 语义不变（仅值）。
- `agentcontrol.SetAgentCard`：真实 apply 成功后，若存在 `agent`/`all` 且未出现在 `Skipped` 中：
  1. 读 `agent:propertyschema`（`wconfig` 已有读取函数：`ReadWaveHomeConfigFile` + 类型转换路径）；
  2. 按 key upsert `{key, name, type, order（保留旧值/追加）, scope}`；
  3. `wconfig.SetBaseConfigValue({ConfigKey_AgentPropertySchema: defs})` → `wconfig.BroadcastConfigUpdate()`。
- dry-run：不发 schema 写，只在 `Messages` 里给出 `scope would update agent:propertyschema (agent:pi)`。

**为什么不在 `agentdata` 内写配置**：patch 流水线的契约是「session/data 域写 + 备份 + 审计」，
settings 属于配置域；前端本来就是「值走 RPC、模板走 SetConfig」两条路，外部保持同一分工。

### 2.4 外部读

`AgentCardResult` 增加：

```go
Schema []wconfig.AgentPropertyDefType `json:"schema,omitempty"`
```

`GetAgentCard` 读模板并按目标会话 source 过滤后填充；CLI 文本输出追加 `schema:` 段（key/type/scope）。

### 2.5 CLI

```
wsh agent card set <id> --prop 优先级=select:P1 --prop-scope agent [--yes --expected-hash h]
```

- `--prop-scope`：`session|agent|all`，默认 `session`，一次调用内对全部 `--prop` 生效（按调用统一，实现最简单）。
- 校验在 `parseCardProps` 之前完成；未知值 → `invalid --prop-scope %q: expected session|agent|all`。

### 2.6 MCP

props 条目：`{type, value, name?, scope?}`，`scope` enum `session|agent|all`，默认 session。
`tools.go` 的描述同步（"all props take the same scope semantics as the card UI"）。

## 3. 兼容与迁移

- 旧 settings.json 无 `scope` 字段 → 解析为空 → 全局。**无迁移脚本**。
- 旧客户端（旧前端）读新 settings：多出的 `scope` 字段被忽略（Go struct 反序列化向后兼容）。
- 旧外部调用（无 `--prop-scope` / 无 `scope`）→ session → 不写模板 → 与改动前行为一致。
- 回滚：单提交 revert；schema 中新增的 `scope` 字段被旧代码忽略，数据无损。

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| settings.json 写失败（磁盘/权限）导致属性值已写、模板没写 | 先写模板再报错？否 —— 与前端一致：值先落（体验优先），模板失败时返回 `Messages` 告警并在 CLI 输出非零？**决策**：模板写失败 → 返回错误（值仍保留），CLI 显示 `schema write failed: ...`，用户可重试 |
| 两个 Agent 的模板同名 key 互相覆盖 | 同一 key 只允许一个定义：upsert 时若已存在且 scope 不同 → 覆盖并返回 message（v1 简化）；文档记录 |
| 并发写 settings.json | 复用 `wconfig.SetBaseConfigValue`（既有单写者语义） |
| `summary.source` 缺失（旧数据） | 过滤时按空 source 处理：仅全局项可见（`agent:` 项不可见），安全降级 |
| 卡片 detail 模式与 hover 卡浮层定位差异 | 复用 `PropertyValuePopover`（portal 到 body + 视口钳位）；两种模式同组件 |

## 5. 验证设计（机器可判定）

- 前端 DOM 测试：`property-list.dom.test.tsx`（浮层、三 scope、回调参数、错误态）。
- 前端模型测试：`property-model.test.ts`（scope 过滤矩阵）。
- 前端 wiring 测试：`session-note-section.test.tsx`（三种 scope 的调用参数：模板写/不写、scope 值）。
- Go：`pkg/agentdata`（scope 透传 dry-run）、`pkg/agentcontrol`（schema upsert 精确性）、
  `cmd/wsh/cmd`（`--prop-scope` 解析/非法值）。
- 真机：新增 verify area `scripts/verify/agent-property-scope/`（或复用现有 agent-card area，若存在）。
  先 `node scripts/verify/index.mjs` 看现有 area 再决定。
