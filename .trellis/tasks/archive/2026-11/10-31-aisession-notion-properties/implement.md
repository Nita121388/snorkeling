# Implement: AI 会话与 Agent 属性系统（Notion 化）

> 开发目录：`/Users/nita/Primary/projects/snorkeling-notion-properties`
> 分支：`feat/aisession-notion-properties`（基于 `main`，main 不直接改动）
> 首次开发前：`npm run setup`

## 0. 准备

- [ ] `cd ../snorkeling-notion-properties && npm run setup`
- [ ] `npx tsc --noEmit` 基线通过（记录现有错误，避免把旧错误算进来）
- [ ] 复看设计文档 §2（Notion 视觉 token）与原型 `design/prototypes/notion-property-agent-card/`

## P1 — 只读映射 + 渲染（最小可见收益）

- [ ] `frontend/app/view/aisessions/property/property-model.ts`
  - `PropertyType` / `PropertyDef` / `PropertyCell` 类型
  - `toPropertyDefs(summary)`：固定顺序 + 旧字段虚拟映射（note/tags/starred/titleSource）
  - 复用 `inferPropertyType()`；`formatValue()` / `isEmpty()`
  - 单测：`property-model.test.ts`（映射、空值、类型推断）
- [ ] `frontend/app/view/aisessions/property/property-list.tsx`
  - 按 type 渲染 value（text/number/select/multi/status/date/person/checkbox/url/formula/relation/created/updated）
  - `mode: "card" | "detail"`：card 隐藏空值 + 前 5 条 + `+N more`
  - 单测：`property-list.test.tsx`（快照/行为）
- [ ] 接入 `session-note-section.tsx`：保留原 `InfoCardSection` 头（标题 + AI 按钮），body 换成 `PropertyList`
- [ ] 接入 `session-row.tsx`：行内 note/tags 区换成 `PropertyList`（或复用其 value 渲染）
- [ ] 回归：AgentHoverCard / SessionDetailInfoCard / 列表行显示与今天等价
- [ ] 验证：`npx tsc --noEmit`、相关 vitest

**Review gate**：截图对比原型（wide + narrow），确认视觉接近；旧 note/tags 数据全部正确显示。

## P2 — 内置属性编辑统一

- [ ] `property/property-store.ts`：`setProp` / `source` / `undoSnapshot`，统一 RPC
- [ ] 编辑器：select/status/multi-select/date/checkbox/text/number/url（先做内置属性需要的）
- [ ] 删除 4 处重复 draft 逻辑：`session-row`、`aisessionnotemodal`、`session-detail` Note 弹窗、`session-note-section`
- [ ] 保留 auto-save / Undo / AI 按钮语义（`session-note-autosave.ts`、`undo-toast.tsx`）
- [ ] 回归：note AI 生成（`gen-action-button`）仍可用；`source=user` 不被覆盖

**Review gate**：4 个 surface 的 note/tags 编辑行为一致；无重复保存/事件风暴。

## P3 — AI 属性生成

- [ ] 后端：`pkg/aisessions/` 新增 `GenerateSessionProperties`（复用 metagenerate worker）
- [ ] `SessionSummary.Props` 落库 + 合并写入 + `source=ai`
- [ ] Suggested 新属性：先进建议区，用户确认后升正式
- [ ] 冲突：`source=user` skip + `Force` + 10s Undo
- [ ] 事件广播 + 前端 merge（`session-note-cache.ts`）
- [ ] 验证：`go test ./pkg/aisessions/ ./pkg/service/aisessionsservice/`

**Review gate**：AI 写入不覆盖用户值；失败可重试；事件驱动刷新无轮询。

## P4 — 自定义 schema

- [ ] `pkg/wconfig` 增 `agent:propertySchema` + 类型重生成
- [ ] 前端：新建/改名/换类型/排序/删除属性（Notion 类型选择器）
- [ ] 属性菜单（`⋮⋮`）：Rename / Change type / Delete
- [ ] 迁移：schema 与 `props` 的一致性校验

**Review gate**：新建属性 → 填值 → 改类型 → 删除全链路可用；旧会话不受影响。

## 验证命令

```bash
# 前端
npx tsc --noEmit
npx vitest run frontend/app/view/aisessions/property
npx vitest run frontend/app/view/aisessions/session-row.test.tsx
npx vitest run frontend/app/element/info-card

# 后端（P3+）
go test ./pkg/aisessions/ ./pkg/service/aisessionsservice/
```

## 回滚点

- P1/P2 前端可整体关闭（feature flag `ai:sessionprops`），回到 Note/Tags 区段。
- P3 后端 worker 默认关闭（沿用 `ai:sessionautotitle` 开关语义）。
- 无破坏性数据迁移，`props` 可随时丢弃重建。

## 本次交付状态（实现记录）

已落地（P0 + P1 核心）：
- [x] Go `SessionSummary.Props` + `PropertyCell`；SQLite `ai_session_props` 表；`PropsForSession` / `SetProps`（合并、nil 删除）；MetaStore 双写；Manager / Service `SetProps` RPC；`generatets` 已同步 TS。
- [x] `property-model.ts`：类型、`toPropertyDefs` 虚拟映射、类型推断（复用 Obsidian `inferPropertyType`）、格式化、空值判定、`slugifyPropertyKey`。
- [x] `property-list.tsx`：Notion 式属性行；card/detail 双形态；+N more；AI ✨；只读态；内联编辑（text/number/select/multi/status/date/checkbox/url）；「+ Add a property」；删除自定义属性。
- [x] `property-store.ts`：内置属性走 NoteAndTags / Mark；自定义属性走 SetProps。
- [x] `SessionNoteSection` 用 `PropertyList` 替换 note 预览 + tags chips；悬浮卡只读，详情卡可编辑。
- [x] 测试：Go `props_test.go` 4 项；前端 model/list 19 项；`go build ./...` / `tsc` / vitest 全绿。

未落地（依赖设计文档 §8 的开放问题拍板）：
- [x] P2 AI 自动生成属性：`GenerateSessionProperties`（只提案）+ `ApplyAIProperties`（拒绝内置键 / source=user 默认跳过 / Force 覆盖 / source=ai 落库）+ `GenerateProperties`/`ApplyProperties` RPC + 前端「✨ AI auto-fill」提案→应用→10s Undo。
- [x] P3（本次按推荐默认实现：全局模板 + 会话级覆盖；`person`=会话 owner 语义）
      - 全局模板 `agent:propertyschema`（wconfig）读写 + 新建属性「Save to template」
      - 自定义属性 Rename / Change type / Move up·down / Delete（⋮ 菜单）
      - `toPropertyDefs` 合并 per-session name/order → 全局模板 → key 推导；模板独有属性 detail 显示 Empty
      - 说明：未做可视化拖拽（用 ⋮ 菜单 Move up/down 代替）；未做独立的属性模板设置页（临时通过 settings.json / Save to template 维护）。

### 数据安全加固（P2 期间发现并修复）
- **真实数据丢失路径**：属性曾双写 JSON meta；props-only 的 JSON 条目 note 为空，下次 `OpenSQLiteIndex` 的 JSON→sqlite 迁移会把 sqlite 真实 note 覆盖成空。修复：属性改为 **sqlite-only**，不再写 JSON meta；并加固 `upsertMetaTx`：JSON 缺 note/title 时绝不清空 sqlite 非空值。
- 回归覆盖：`TestSetPropsDoesNotTouchNoteAndTags`、`TestManagerApplyAIPropertiesSafety`（AI 不动 note/tags、不覆盖 user 值、Force 只影响 user props）、`TestApplyMetaLeavesLegacyFieldsWhenNoProps`。
- [ ] session-row 行内编辑器与 PropertyList 合并（4 处 draft 去重）——独立重构，风险较高，留作下一步。
