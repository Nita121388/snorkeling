# 属性 status 类型彻底退役：数据迁移 status→select + 改类型交互修复

## Goal

彻底剥离属性系统里的历史 `status` 类型：**数据层、后端词表、前端类型、i18n 全部只认 `select`（单选）**，
存量数据一次性迁移写回；同时修复 agent card 上「修改属性类型一点击就关闭、无法编辑」的交互 bug。

用户原话（2026-11-20）：
> 我门当前 agent card 有个状态属性，历史中这个状态属性是状态类型，我希望彻底剥离这个历史，
> 没有状态类型，将其彻底改为单选类型……另外 agent card 上修改属性类型一点击就关闭了，导致编辑不了。

## 背景（现状调查）

- 上一次提交 `44046ab9f`（"移除 status 属性类型"）**只做了前端读时归一**（`normalizePropertyType`），
  是半成品：`PropertyType` 联合类型仍保留 `"status"` 字面量、`ALL_PROPERTY_TYPES` 仍列出、
  `DropdownTypes` 仍含 status、i18n `propertyType.status="状态"` 还在。
- 后端完全未动：
  - `pkg/aisessions/propertygenerate.go`：`propertyTypeWhitelist` 含 `status`；`ValidatePropertyValue` 有 `case "text","url","select","status"`
  - `pkg/agentdata/patch.go:797`：`validAddOptionPropertyType` 含 `status`，错误文案还写 "select, multi_select or status"
  - `pkg/wconfig/settingsconfig.go`：`AgentPropertyDefType.Type` jsonschema enum 含 `status`（`schema/settings.json:78` 同）
- **存量数据零迁移**：sqlite `ai_session_props.prop_type` 存的 `"status"`、
  `settings.json → agent:propertyschema[].type` 存的 `"status"` 原样保留。
  用户当前版本的"状态"属性在数据层仍是 status，UI 显示单选只是读时假象。
- 改类型 bug：`property-list.tsx` 的改类型控件是原生 `<select autoFocus onBlur={()=>setRetypeKey(null)}>`。
  Windows/Electron 下原生 select 弹出会夺走 web 焦点 → select 收到 blur → 控件被立即卸载 → 无法选择。

## Requirements

### A. status 类型彻底退役

- **R1 后端词表收口**：`select` 是唯一的单选类型。
  - `propertyTypeWhitelist`、`ValidatePropertyValue`、`validAddOptionPropertyType`、错误文案、
    wconfig jsonschema enum 中全部移除 `status`。
  - 新增 `NormalizePropertyType(raw string) string`（`pkg/aisessions`）：`"status"`（大小写/空白不敏感）→ `"select"`，
    其余 trim 后原样返回；作为**写边界归一**的唯一实现。
- **R2 写路径归一**（status 进来不再落库）：
  - `agentdata.ApplyPatch`：在 `normalizeSessionEmojiPatchOperations` 旁新增
    `normalizeLegacyPropTypes(operations)`，把每个 `op.Props[*].Type` 过 `NormalizePropertyType`
    （agent card CLI/MCP/RPC 全走这里）。
  - `aisessions.Manager.SetProps`：写入前对每个 cell.Type 归一（前端 `service.SetProps` 直写路径）。
  - `aisessions.ApplyAIProperties` + `propertygenerate.parsePropertySuggestions`：AI 提案 type=status 归一为
    select 再校验（不再因 status 被白名单拒绝而丢提案）。
- **R3 一次性数据迁移**（存量写回 select）：
  - sqlite：`ai_session_props` 里 `lower(trim(prop_type))='status'` 的行 → `prop_type='select'`；
    迁移前 `VACUUM INTO` 备份（沿用 tag 迁移的 backup 模式）；用 `ai_schema_meta` 键
    `session_props_status_type_migrated` 做一次性哨兵，二次打开直接跳过。
  - settings：新增 `wconfig.MigrateAgentPropertySchemaStatus()`，启动时（`cmd/server/main-server.go`，
    挂在 `MigratePresetsBackgrounds()` 旁）把 `agent:propertyschema` 里 `type` 为 status（大小写不敏感）的
    定义改写为 select 并 `SetBaseConfigValue` 写回 + broadcast；无 status 定义时 settings 字节级不变。
- **R4 前端类型收敛**：
  - `PropertyType` 联合类型删除 `"status"`；`normalizePropertyType` 保留为内部 legacy 兜底
    （签名放宽为接受原始 string），防旧库/同步镜像未迁移数据；`ALL_PROPERTY_TYPES`、`typeLabel`、
    `DropdownTypes` 删除 status；i18n（zh/en）删 `propertyType.status`。
  - 重新生成 `schema/settings.json` 与 `frontend/types/gotypes.d.ts`
    （`go run cmd/generateschema/main-generateschema.go`）。

### B. 改类型交互修复

- **R7（2026-11-20 追加，用户补充反馈）**：值列表弹窗（共享 `PropertyTagEditor` 浮层）容易误关闭。
  根因：容器 `onBlur` 把「焦点逃逸」当关闭信号（Windows/Electron 下点浮层自身空白即触发）+
  `useDismiss outsidePress` 不豁免浮层内区域。修法：删除 blur 关门；列表区空白 `mousedown` `preventDefault`
  保住输入焦点；关闭只认三条：Esc / 点浮层外部 / 单选提交。
- **R5** 删除原生 `<select>` 改类型控件，改为**浮层类型菜单**：
  点属性菜单「修改类型」→ `PropertyValuePopover`（portal + info-card pin）锚在行内，
  列出 `CreatableTypes`（图标 + i18n 标签 + 当前类型 ✓），点击某项 → `onRetypeProperty(key, type)` → 关闭。
  浮层打开必须能在 hover 卡上存活（不被 blur/焦点变化立即关掉）——这正是本次 bug 的验收点。
- **R6** 只读行（builtin/formula 等）不出现改类型入口（现状已如此，保持）。

## Acceptance Criteria（判据全带数字）

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go build ./..."` → 退出码 0
- [ ] `go test ./pkg/aisessions ./pkg/agentdata ./pkg/agentcontrol ./pkg/wconfig -count=1` → 全部 `ok`，
      其中新增：
  - `TestNormalizePropertyTypeLegacy`：`"status"/" Status "/"STATUS"` → `select`；`"select"/"multi_select"/"text"` 原样
  - `TestSQLiteMigratePropTypeStatus`：造 3 行 status + 2 行 select → 迁移后 status 行数 = 0、
    select 行数 = 5；重复执行第二次 = 幂等（不新增备份、不改数据）；迁移哨兵键已写入
  - `TestApplyPatchNormalizesLegacyStatusType`（或并入 e2e）：patch 带 `type:"status"` →
    落库 cell.Type == `"select"`；dry-run preview 同样显示归一后类型
  - `TestMigrateAgentPropertySchemaStatus`：settings 里 1 条 status 定义 → 迁后 `type=="select"`、
    其它字段（options/order/scope/aiManaged）逐字段不变；无 status 的 settings → 返回"未变更"（不写盘）
- [ ] `npx vitest run frontend/app/view/aisessions/property/ frontend/app/element/info-card/ frontend/app/element/property-editor/` → 全绿，
      其中新增 DOM 测试：
  - 打开类型菜单后触发一次外部 focus/blur（模拟旧 bug 场景）菜单**仍在**（`data-testid=property-type-menu` 仍挂载）
  - 点击菜单里"单选/select"项 → `onRetypeProperty` 收到 `("status","select")` 这类正确 key/type
  - 菜单不再渲染任何原生 `<select>`（断言 `container.querySelector("select") === null`）
- [ ] `npm run i18n:check` → 通过（zh/en 删 status 后 parity 仍平衡）
- [ ] `npx eslint` 触碰的前端文件 → 0 error；`node scripts/check-tsc-baseline.mjs` → 白名单 0 新增 error
- [ ] R7 单测（`tag-editor.dom.test.tsx` 新增 describe）：点 `.ptag-list` 空白不关（onClose 0 次）且
      mousedown `defaultPrevented === true`；input `focusout`/`blur` 不关；Esc 仍关（onClose 1 次）
- [ ] UI 验证台：`node scripts/verify/property-editor/verify.mjs` → 退出码 0。
      台内新增 case：agent 卡上打开「修改类型」浮层 → 断言浮层出现且 **1200ms 后仍在 + 指针移入浮层卡片不收**
      （只开菜单不点选，遵守该台只读约束，不写真实会话元数据）
- [ ] 数据迁移真机抽样：迁移后用 sqlite 查询 `SELECT count(*) FROM ai_session_props WHERE prop_type='status'` → 0
      （作为验收记录写进任务 Notes，允许用临时脚本在备份库副本上验证）

## 白名单（只允许改/新增）

- Go：`pkg/aisessions/{propertygenerate.go,manager.go,sqlite_index.go}` + 对应 `_test.go`
- Go：`pkg/agentdata/patch.go` + `_test.go`
- Go：`pkg/wconfig/settingsconfig.go` + `_test.go`、`cmd/server/main-server.go`（挂迁移调用，1 行）
- 生成物（跑生成器后整体重写）：`schema/settings.json`、`frontend/types/gotypes.d.ts`
- 前端：`frontend/app/view/aisessions/property/{property-model.ts,property-list.tsx,property-list.scss}` + 测试
- 前端：`frontend/i18n/locales/{zh,en}/aisessions.json`
- 验证台：`scripts/verify/property-editor/verify.mjs`、`docs/project/verify-ledger.md`（台账一行）
- 前端（R7）：`frontend/app/element/property-editor/{tag-editor.tsx,tag-editor.dom.test.tsx}`
- 前端（类型收窄的连带测试修正）：`frontend/app/session-overview/overview-board-props.test.ts`
- 任务文档：`.trellis/tasks/11-20-property-status-to-select/**`

## 明确不做

- 不动属性 key 本身：用户叫"状态"的属性 key（可能是 `status`）**保留**，只改类型语义
- 不实现 Notion status 的分组/自动推进（那才需要 status 类型；本仓从未实现）
- 不碰 `pkg/agentcontrol/card_schema.go` 的 scope 语义（`11-11-agent-property-scope` 的地盘）
- 不碰 `frontend/app/commontext/**`、`frontend/app/element/info-card/session-note-section.tsx` 的写路径结构
  （retype 回调签名不变，无需改）
- 不做 schema 定义的批量「重置 options」入口
- 不顺手修 `patchDomains` 不给纯 props 补丁打 SQLite backup 的既有缺口（归 `11-09-agentdata-backup-granularity`）

## Notes

- 相关任务：`11-19-property-ui-add-option`（候选追加，已完成代码）、`11-11-agent-property-scope`（scope 语义）
- 本次"读时归一 + 写回迁移"完成后，`normalizePropertyType` 只剩兜底职责；若后续确认全量数据已迁移，
  可在下一个清理包里删掉（本包不做，避免破坏旧库兼容）
