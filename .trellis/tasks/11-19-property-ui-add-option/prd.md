# Agent 卡片属性：UI 新值自动追加候选（单选/多选）

## Goal

在界面上给一个单选/多选属性写入一个**不在候选表里**的新值时，把这个新值自动追加进该属性的模板候选，
下次下拉里就能直接选到。当前只有 CLI/Agent 通道有 `--prop-add-option`，**手动 UI 通道完全没有**：

- `frontend/app/view/aisessions/property/property-list.tsx` 提交值只调 `setSessionProperty`（只写会话值），
  从不碰 `def.options`。
- `property-schema.ts` 已有 `setPropertySchema` / `upsertSchemaDef`（写模板），但只被
  `session-note-section.tsx` 用于「新建/删除整个属性定义」，没有一条路径是「给已有属性追加候选」。
- 用户实测：状态属性已有「新建中/进行中/已完成」，手加「待继续」→ 值进得去，候选里没有；
  换个会话或改选别的值就消失（因为代码只会把「当前值」临时渲染成候选）。

## 已定决策（2026-11-19，nita）

> 原话：「OK，按照你推荐的来。」——采纳推荐选法 **B：只在 agent / 全局 scope 的模板定义上追加**。

| # | 结论 | 原因 |
|---|---|---|
| 1 | 追加条件 = 该属性的定义来自模板且 `def.scope ∈ {agent, global}` | 与 CLI 侧一致：`--prop-add-option` 要求 `--prop-scope agent/all` 才写模板 |
| 2 | 会话级私有属性（`def.scope === "session"`）**不追加** | 私有属性本就不共享，写全局模板会污染其它项目 |
| 3 | 追加 = 在 `options` **末尾**加 `{id: value, name: humanizeKey(value), color: "default"}` | 换序会让用户已习惯的位置跳动；颜色由用户后续自选 |
| 4 | 重复值、已存在值：不追加、**不重写模板** | 无新增时 settings 必须字节级不变（CLI 侧同一不变量） |

## Requirements

- **R1 触发点**：`property-list.tsx` 的值提交路径（`commitDropdown` / 文本输入 commit / 多选 commit）
  在值写成功后，检查是否需要追加候选。覆盖 `select`、`status`（读时归一为 select）、`multi_select`。
- **R2 追加实现单点**：新增纯函数（建议放 `property-schema.ts` 或 `property-model.ts`）
  `appendOptionToSchemaDefs(defs, key, values): {next, changed}`——幂等、保序、大小写不敏感去重、
  **绝不删已有 option**、`changed === false` 时调用方不得发 `setPropertySchema`。
- **R3 scope 门禁**：只对 `def.scope !== "session"` 的属性追加；`session` 一律跳过（值照常写）。
- **R4 失败降级**：模板写失败**不得**回滚或阻断已成功的值写入；只记 `console.warn`（值是本操作的主目标）。
- **R5 幂等**：连续两次设置同一个新值 → 只追加一次；`settings.json` 在第二次不发生变化。
- **R6 不碰后端**：本包纯前端（CLI 侧已可用）；不改 `pkg/**`。

## Acceptance Criteria

- [ ] 单测 `property-schema-add-option.test.ts`（或并入既有测试文件）：
  - 追加新值 → `options` 末尾出现该值，原有候选顺序不变
  - 重复追加 → `changed === false`，`options` 长度不变
  - 大小写/重复值去重（`Doing` vs `doing` 归一策略需在实现里写死并断言）
  - `def.scope === "session"` → 不追加（`changed === false`）
  - `multi_select` 一次提交多个新值 → 全部追加且保序
  - 命令 + 期望：`npx vitest run frontend/app/view/aisessions/property/` → 全绿
- [ ] DOM 测试：在属性行提交新值后，**同一属性**的下拉候选含该值（读 DOM 或读 store 均可；不得只测纯函数）
- [ ] 会话级属性：提交新值后模板不变（断言 `setPropertySchema` 未被调用）
- [ ] 模板写失败（mock reject）时：值写入仍成功，无未捕获异常
- [ ] 回归：`npx vitest run frontend/app/element/info-card/` 全绿（`session-note-section` 共用 schema helpers）
- [ ] `npx eslint` 白名单文件 0 error；`node scripts/check-tsc-baseline.mjs` 白名单 0 新增 error

## 白名单（只允许改/新增）

`frontend/app/view/aisessions/property/**`（`property-list.tsx`、`property-store.ts`、
`property-schema.ts`、`property-model.ts` 及对应测试、新建测试文件）、
`.trellis/tasks/11-19-property-ui-add-option/**`

## 明确不做

- 不改 `pkg/**`（后端 CLI 侧已实现，`MergePropertyOptions` / `appendSchemaOptions`）
- 不碰 `frontend/app/block/blockframe-header.tsx`（另一 agent 在改）
- 不碰 `frontend/app/commontext/**`、`frontend/wave.ts`、`frontend/app/wave/**`、`pkg/aisessions/**`
- 不做「只加候选不写值」的 CLI 下一片（CLI 文档 §6 item 6，另开包）
- 不改 `agent:propertyschema` 的 scope 编码语义（`""` = 全局，`"agent:<source>"` = agent）

## Notes

- 两套编码与 scope 语义的权威说明：`.trellis/spec/snorkeling-docs/backend/agent-control-surface-contract.md` §10
- 前端 scope 映射已存在：`property-model.ts` 里 `PropertyDef.scope: "session" | "agent" | "global"`，
  模板项由 `""`/`agent:<source>` 归一而来
- CLI 侧同一不变量的实现参考：`pkg/agentdata/patch.go: MergePropertyOptions`（幂等/保序/大小写不敏感）
