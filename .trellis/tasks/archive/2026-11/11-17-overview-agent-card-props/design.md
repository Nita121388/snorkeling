# Design — Overview agent 卡面三件套

## 1. 边界与数据流

```
Summary RPC（已有）
    │
    ▼
SessionSummary { note, tags, props: {[key]: PropertyCell} }
    │
    ├─► session-overview-session-cache（已有）
    │       │
    │       ▼  useSessionSummaries（已有）
    │   summaries[sessionId].summary
    │       │
    │       ├── boardCards useMemo ──► resolveBoardPropRows(summary.props, schema)
    │       │                               │
    │       │                               ▼
    │       │                      OverviewBoardCard.propRows
    │       │                               │
    │       │                               ▼
    │       │                        BoardCard JSX（新增 .session-overview-board-card-props 行）
    │       │
    │       └── BlockRow ──► 同 resolveBoardPropRows + resolveBoardTagChips
    │                              │
    │                              ▼
    │                        列表行 tags + props 紧凑区
    │
    └─► usePropertySchema()（wconfig agent:propertyschema，可选，仅用于 select/status 着色）
```

**不新增 RPC、不动后端、不动属性写入链路**（property-store/SetProps 已有闭环，通过 `dispatchAISessionNoteUpdated` 广播）。

## 2. 纯函数（`overview-board-model.ts`）

### 2.1 `BoardPropRow`

```ts
export type BoardPropRow = {
    key: string;
    /** cell.name || humanizeKey(key) */
    name: string;
    type: PropertyType; // 从 cell.type 读取，兜底 "text"
    /** select/status 单值（着色胶囊的文本） */
    single?: { value: string; color?: string /* ColorToken */ };
    /** multi_select/person/relation 多值 chips */
    multi?: string[];
    /** checkbox */
    checked?: boolean;
    /** text/number/url/date 单行文本 */
    text?: string;
};
```

### 2.2 `resolveBoardPropRows(props, schema?, max = 3): { visible: BoardPropRow[]; hiddenCount: number }`

- 过滤内置 key（`note` / `tags` / `starred` / `createdAt` / `updatedAt` / `titleSource`，即 `BUILTIN_PROP_KEYS` 集合）—— 这些由卡片已有行渲染
- 过滤空值：`null` / `""` / `[]` / `checkbox === false` 一律跳过
- 排序：`cell.order > 0` 优先按 `order`，否则按 `Object.keys` 插入顺序（`sort()` 保证稳定）
- 着色：仅 `select`/`status` 单值时，从 `schema` 按 key 找 `options[].color`；schema 未提供或值不在 options → `color = undefined`（渲染为 default 胶囊）
- 上限：`visible.length = min(rows, max)`，溢出合并进 `hiddenCount`
- **不 import property-model 实现**（保持纯函数无反向依赖），仅 `import type { PropertyCell, PropertyType } from "@/app/view/aisessions/property/property-model"`（type-only，仅借类型）

## 3. 渲染改动

### 3.1 看板卡（`overview-board.tsx` `BoardCardImpl`）

行序：`head → meta（含 tags）→ props（新增）→ preview → note → data`

```tsx
{card.propRows.visible.length > 0 ? (
    <span className="session-overview-board-card-props" data-board-props={card.propRows.visible.length}>
        {card.propRows.visible.map((row) => (
            <span key={row.key} className="session-overview-board-card-prop" data-board-prop={row.key} data-board-prop-type={row.type}>
                <span className="session-overview-board-card-prop-name">{row.name}</span>
                {row.single ? <span className={cn("property-chip", row.single.color && `property-chip--${row.single.color}`)}>{row.single.value}</span> : null}
                {row.multi?.map(v => <span key={v} className="property-chip">{v}</span>)}
                {row.checked != null ? <i className={cn("fa-sharp", row.checked ? "fa-check" : "fa-xmark")} /> : null}
                {row.text ? <span className="session-overview-board-card-prop-text">{row.text}</span> : null}
            </span>
        ))}
        {card.propRows.hiddenCount > 0 ? (
            <span className="session-overview-board-card-prop-more" data-board-prop-overflow={card.propRows.hiddenCount} title={i18n.t("session-overview:board.moreProps", { count: card.propRows.hiddenCount })}>+{card.propRows.hiddenCount}</span>
        ) : null}
    </span>
) : null}
```

样式复用 `property-list.scss` 的 `property-chip` / `property-chip--<color>` 类（9 色 Notion 调色板）。**前提：`overview-board.tsx` 显式 `import "@/app/view/aisessions/property/property-list.scss"`**，保证跨文件类加载。

### 3.2 列表行（`session-overview.tsx` `BlockRow`）

`session-overview-block-side` 内新增紧凑 tags + props 区（在度量轨与 note 行之间）：

```tsx
{block.isAgentLike && (tagChips.visible.length > 0 || propRows.visible.length > 0) ? (
    <div className="session-overview-block-row-meta" data-overview-row-meta>
        {tagChips.visible.map(tag => <span key={tag} className="session-overview-board-chip is-tag" data-overview-row-tag={tag}>#{tag}</span>)}
        {propRows.visible.map(row => <span key={row.key} className="session-overview-board-chip" data-overview-row-prop={row.key}>{row.name}: {row.text ?? row.single?.value ?? row.multi?.join("/") ?? (row.checked ? "✓" : "✗")}</span>)}
        {propRows.hiddenCount > 0 ? <span className="session-overview-board-chip is-more">+{propRows.hiddenCount}</span> : null}
    </div>
) : null}
```

`BlockRow` 顶部调 `usePropertySchema()` + `useMemo(() => resolveBoardPropRows(summary?.props, schema), [summary?.props, schema])`。

### 3.3 悬浮卡空态（`session-note-section.tsx`）

`if (summary == null) return null;` 改为：

```tsx
if (summary == null) {
    if (variant !== "hover") return null;
    return (
        <InfoCardSection>
            <div className="agent-card-title-wrap" data-session-note-loading>
                <div className="agent-card-title-block is-loading">{i18n.t("element:sessionNote.loading")}</div>
            </div>
        </InfoCardSection>
    );
}
```

**`variant === "detail"` 行为零变化**（详情卡已有自己的 loading 态）。

## 4. i18n（Pattern F，读时翻译）

| key | zh | en |
|---|---|---|
| `session-overview:board.moreProps` | `另有 {{count}} 条属性` | `+{{count}} more` |
| `element:sessionNote.loading` | `正在加载会话信息…` | `Loading session info…` |

## 5. 性能

- `resolveBoardPropRows` 在已有 useMemo 内，props 是 summary 的引用，无新 RPC / 无额外订阅
- 看板卡 `BoardCard` 已 `React.memo`，`propRows` 是稳定引用（父级 useMemo 产出）
- 列表行 `BlockRow` 无 memo（现状），新增 hook 不引入额外订阅

## 6. 兼容与回滚

- 老数据（`summary.props` 为空/无自定义）→ `resolveBoardPropRows` 返回 `{ visible: [], hiddenCount: 0 }` → 属性行不渲染，无副作用
- `OVERVIEW_BOARD_ENABLED` 开关不变（看板整体回滚路径不变）
- 悬浮卡空态仅影响 `variant="hover"`，detail/弹窗零变化