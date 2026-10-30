# Design: AI 会话与 Agent 属性系统（Notion 化）

> 完整方案见 `design/plans/aisession-notion-properties.md`（类型全表、Notion 视觉 token、AI 契约、风险）。
> 本文只记录**实现边界与契约**，避免与设计文档重复。

## 1. 模块边界

```
pkg/aisessions/                     frontend/app/
  types.go        SessionSummary      store/session-note-cache.ts   ← 缓存/事件
  store (props)   PropertyCell         view/aisessions/
  metagenerate.go AI 属性生成           ├─ property/ (新建)
  titleautogen.go worker 骨架           │   ├─ property-model.ts    类型/映射/推断
                                        │   ├─ property-store.ts    读写 + source + undo
                                        │   ├─ property-list.tsx    列表渲染
                                        │   └─ property-editors/    select/date/...
                                        ├─ session-row.tsx          ← 接入
                                        ├─ session-detail.tsx       ← 接入
                                        └─ element/info-card/
                                            session-note-section.tsx ← 降级为 PropertyList 的一层包装
```

**单一真相源**：`SessionSummary.props`。所有 surface 只读它，不各自维护 noteDraft/tagDraft。

## 2. 契约

### 2.1 Go 端

```go
type PropertyCell struct {
    Value     any    `json:"value"`
    Source    string `json:"source"`    // user | ai | system
    UpdatedAt int64  `json:"updatedAt"`
}

type SessionSummary struct {
    // ...现有字段保持不动
    Props map[string]PropertyCell `json:"props,omitempty"`
}
```

- 写入统一走 `SetSessionProps(key, map[string]PropertyCell)`（合并语义，非整表替换）。
- 旧字段写入仍走原 RPC；`props` 是叠加层。
- 读取时虚拟映射：`note` → `props.note`(text)、`tags` → `props.tags`(multi_select)、
  `marked` → `props.starred`(checkbox)、`titleSource` → `props.title_source`(select, readonly)。
  映射只在读路径生成，不落库（除非用户/AI 显式写 props）。

### 2.2 前端

```ts
type PropertyType = "text" | "number" | "select" | "multi_select" | "status"
    | "date" | "person" | "checkbox" | "url" | "formula" | "relation"
    | "created_time" | "updated_time";

type PropertyDef = {
    key: string; name: string; type: PropertyType;
    options?: SelectOption[]; order: number;
    scope: "session" | "agent"; builtin?: boolean;
    aiManaged?: boolean; aiInstruction?: string;
    readOnly?: boolean; formula?: { kind: string };
};
```

- `property-model.ts` 导出 `toPropertyDefs(summary)`（含旧字段虚拟映射）、
  `inferPropertyType()` 复用、`formatValue()`、`isEmpty()`。
- `property-store.ts` 导出 `setProp(key, value)` / `setPropSource()` / `undoSnapshot()`，
  统一走 `service.NoteAndTags` 或新 `SetSessionProps`（P0 先只读，P1 再接线）。
- `PropertyList` 只接收 `{ summary, defs, mode: "card" | "detail" }`，不读全局 store。

## 3. 数据流

```
用户编辑 → property-store.setProp(key, value, "user")
        → RPC（SetSessionProps / 旧字段 RPC）
        → 后端落库 + 广播 aisessions:noteupdated
        → session-note-cache.merge
        → 所有 PropertyList 重渲染

AI 生成 → gen worker → 写 props(source=ai) → 广播 → 前端 merge + ✨ 标
```

## 4. 兼容与回滚

- **兼容**：旧字段永远可写可读；`props` 缺失时全部由虚拟映射生成，UI 与今天一致。
- **回滚**：P0/P1 只读/编辑路径可整体关闭（feature flag `ai:sessionprops`），关闭后回到 Note/Tags 区段。
- **不做数据迁移**：没有破坏性 schema 变更；`props` 可随时丢弃重建。

## 5. 风险

| 风险 | 对策 |
|---|---|
| 4 处编辑器漂移 | 收敛为单一 `PropertyList` + 单一 store，逐个 surface 替换 |
| AI 覆盖用户值 | `source=user` 默认 skip + Force + Undo |
| schema 膨胀 | 新属性先进 Suggested，用户确认后升正式 |
| 卡片空间 | 窄态前 5 条 + `+N more` |
| 类型漂移 | schema 定型后 AI 不得改类型，只能新增 |

## 6. 分期边界

- **P0**：只读映射 + 渲染（无新 RPC）。验收：卡片/详情显示与今天等价 + Notion 视觉。
- **P1**：内置属性编辑统一。验收：note/tags/starred 在 4 个 surface 行为一致。
- **P2**：AI 属性。验收：复用 gen-backend，source/重试/Undo 全通。
- **P3**：自定义 schema。验收：wconfig 读写 + 新建/改名/换类型/排序/删除。
