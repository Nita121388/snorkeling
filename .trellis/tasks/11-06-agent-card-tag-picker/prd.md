> **Confirmed: 2026-11-06 @nita**

# Agent 卡片标签选择器：全局候选 + 计数

## Goal

agent 卡片上的 Tags 编辑**已经是**共享的 Wolai 风格浮层编辑器
（`element/property-editor/tag-editor.tsx` 的 `PropertyTagEditor`，多选 chip + 输入过滤 + 创建行），
但它给出的候选项只有**本会话自己已有的标签**：

```ts
// property-list.tsx:131 dropdownOptions(def, value)
for (const option of def.options ?? []) push(option.id);   // ← def.options 来自 property-model.ts:200
for (const item of itemsFromValue(value)) push(item);      // ← 本会话已选值
```

`def.options` 的唯一来源是 `property-model.ts:200` 的 `tags.map(tagToOption)` —— 即 `summary.tags`。
所以用户打开 Tags 编辑器时，**看不到别的会话用过哪些标签**，也就无法「选一个已有标签」。

本次补齐这一块：
1. 候选清单上提到**全局标签清单**（`Tags` RPC 的 `SessionTagSummary{tag, count}`，后端已有）；
2. 每个候选项显示 `count`；
3. 三个卡片面（hover 卡 / AgentCardModal / Tab「更多」首块）自动生效 —— 它们共用
   `SessionNoteSection → PropertyList → PropertyTagEditor` 这一条链。

## 背景（代码事实，均已核对）

| 事实 | 位置 |
|---|---|
| 多选编辑器已是共享浮层，非逗号文本框 | `element/property-editor/tag-editor.tsx`（`PropertyTagEditor`）；`property-list.tsx:808` 唯一消费点 |
| 候选项 = def.options + 本会话已选值 | `property-list.tsx:131-143` `dropdownOptions()` |
| def.options 只来自 `summary.tags` | `property-model.ts:200` `pushBuiltin(tags, "multi_select", tags, false, tags.map(tagToOption))` |
| 全局标签清单 + 计数已由后端提供 | `pkg/aisessions/types.go:141` `SessionTagSummary{Tag, Count}`；`sqlite_index.go:1596 ListTags`；RPC `AISessionsService.Tags` |
| 前端目前只有 aisessions 筛选面板用它 | `aisessions.tsx:735` → `availableTagsAtom` → `filter-panel.tsx:640` |
| md 预览属性卡共用同一编辑器 | `preview/plugins/md-properties/obsidian-properties-card.tsx:443` |
| 既有测试已锁「浮层 + ✓ 选中态」 | `property-list.dom.test.tsx:218-275`（`property-tag-editor` / `.ptag-option`） |

## Requirements

- **R1 单一标签源**：新增前端共享 store `app/store/available-session-tags.ts`，
  按 `(connection, origin)` 分桶缓存 `Tags` RPC 结果。aisessions 筛选面板与卡片候选项读同一 store，
  不允许出现第二份全局标签清单来源。
- **R2 候选项并入全局清单**：`PropertyTagEditor` 的 `options` 增加可选 `counts` 通道；
  `PropertyList` 的 `dropdownOptions()` 在**保持 def.options + 已选值**的前提下，
  追加全局清单里尚未出现的标签。
  - 顺序：已选值在前 → def.options → 全局清单（按 count 降序、同 count 字母序）；
  - 已选但任何清单里都没有的值仍然可见（不丢用户数据）。
- **R3 计数展示**：候选项右侧渲染 `count`；无 count 的候选项（本会话已选值 / def.options /
  用户新建值）**不渲染计数字段**，不伪造 0。
- **R4 写入路径不变**：仍走 `onChange` → `commitDropdown` → `onChange(key, nextArray, def)` →
  `setSessionProperty`。不新增 RPC、不改 Go 侧、不动 `NoteAndTags`。
- **R5 作用域隔离**：候选清单按当前 block 的 `connection`（+ `origin`）取，不跨机器混标签。
- **R6 降级安全**：`Tags` RPC 失败 / 未就绪时，候选项退化为「def.options + 已选值」——
  与今天行为逐字节等价，不阻塞编辑、不抛错到卡片。
- **R7 md 预览属性卡不受影响**：`obsidian-properties-card.tsx` 不传 `counts`，
  其候选行为保持原样（它没有 count 数据源）。

## Non-goals

- 不做 Overview 看板卡的 ack（用户已确认 agent card ack 已存在，明确不做）。
- 不在卡片行上加 `Tags N` 总数徽标（本次只做「候选项显示计数」）。
- 不重写 `PropertyTagEditor` 的交互（chip / 过滤 / 创建行 / 键盘导航全部保留）。
- 不做标签重命名 / 删除 / 批量管理界面。
- 不改 Go `Tags` / `ListTags` 语义与筛选参数。
- 不改 note 编辑、属性增删改排序等其它 PropertyList 行为。

## Acceptance Criteria

- [ ] **AC1** `npx vitest run frontend/app/view/aisessions/property` → 全绿，且新增用例覆盖：
      全局清单里未在本会话出现的标签**出现在候选项**、其 `count` 可见、
      点选后 `onChange` 收到完整数组、再点取消。
- [ ] **AC2** `npx vitest run frontend/app/view/aisessions` → 全绿（筛选面板切到共享 store 后无回归）。
- [ ] **AC3** `npx vitest run frontend/app/element/property-editor frontend/app/view/preview/plugins/md-properties` → 全绿
      （共享编辑器改动不破坏 md 预览属性卡；R7 的回归门）。
- [ ] **AC4** 新 store 单测：同 key 二次调用命中缓存不重复发 RPC；不同 `connection` 分桶互不污染；
      RPC 失败返回空清单且不缓存错误态。
- [ ] **AC5** 真机 CDP：hover 卡片 Tags 行点开 → 候选项包含**本会话没有的**标签且带计数；
      点选后卡片 chip 立即更新。截图 + `report.json` 落 `verify-runs/agent-card-tags/`。
- [ ] **AC6** `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=47`（实测基线 47）。
- [ ] **AC7** 三个卡片面（hover 卡 / AgentCardModal / Tab 更多首块）在同一 `connection` 下
      读到同一个候选清单（CDP 比对文本）。

## 判据（loop 门链用，命令 → 期望输出）

| # | 命令 | 期望 |
|---|---|---|
| 1 | `npx vitest run frontend/app/view/aisessions/property` | `passed` |
| 2 | `npx vitest run frontend/app/view/aisessions` | `passed` |
| 3 | `npx vitest run frontend/app/element/property-editor` | `passed` |
| 4 | `npx tsc --noEmit -p tsconfig.json \| grep -c "error TS"` | `<=47` |

## Notes

- 候选清单**不**复用 `summary.tags`：那是「本会话已有」的集合，不是「全局可选」的集合。
  两者都要 —— 已选集合来自 `summary.tags`，可选项来自 `Tags` RPC。
- 计数语义：`count` 是**当前筛选条件下**的出现次数（后端按 `ListOptions` 统计）。
  卡片选择器只传 `connection` / `origin`（最小过滤），避免计数被 aisessions 的临时筛选污染。
- **原规划曾假设「逗号文本框」，实测已不存在**（`grep draft.split` 无命中，编辑器早已是浮层）。
  本 PRD 已按实际代码修正；`implement.md` 同步更新，删掉了「删除逗号路径」这一步。
