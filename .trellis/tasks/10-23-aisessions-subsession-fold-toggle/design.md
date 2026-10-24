# 技术设计：子会话折叠的全局开关与视觉层级

## 1. 状态模型

新增一个**内存态**的全局覆盖变量，与两类持久状态（`expandedParents`、`autoExpandedParents`）解耦。

```ts
// aisessions.tsx
type SubSessionsOverride = "expanded" | "collapsed" | null;
const [subSessionsOverride, setSubSessionsOverride] = useState<SubSessionsOverride>(null);
```

渲染用的展开集合（唯一真相）：

```ts
const renderedExpandedParents = useMemo(() => {
    if (subSessionsOverride === "expanded") return [...allParentKeys];
    if (subSessionsOverride === "collapsed") return [];
    // 默认路径：用户手动展开 ∪ 筛选自动展开
    return autoExpandedParents.length === 0
        ? expandedParents
        : [...new Set([...expandedParents, ...autoExpandedParents])];
}, [subSessionsOverride, allParentKeys, autoExpandedParents, expandedParents]);
```

状态迁移：

```flow
手动(默认) -> 全部展开: 点全局按钮（不是全部展开时）
手动(默认) -> 全部收起: 点全局按钮（已全部展开时）
全部展开 -> 手动: 点任一父行箭头（把当前集合物化进 expandedParents）
全部收起 -> 手动: 点任一父行箭头（清空 override，再按手动逻辑展开该父）
```

要点：

- `subSessionsOverride` **不落盘**。刷新后回到 `expandedParents`（默认 `[]` = 折叠），
  满足「一键展开不改变默认折叠」。
- 「全部收起」额外做三件事：`setExpandedParents([])`、`setFullyExpandedParents(new Set())`、
  把 `allParentKeys` 全部写入 `suppressedAutoExpandRef`，防止筛选自动展开/60s 刷新把它撑开。
- 手动点箭头时先把 `renderedExpandedParents` 物化成数组再增删，保证在 override 生效期间
  点击也能得到用户预期的结果。

## 2. 父行集合的单一来源

不在两处树（`groupedSessions[].tree` / time 模式的 `flatTree`）里各算一遍，改为从
「已排序的可见会话」直接推导，规则与 `buildSessionTree` 的根部判定保持一致：

```ts
// session-tree.ts
export function collectParentKeys(sessions: SessionSummary[]): Set<string> {
    const known = new Set(sessions.map((s) => s.key));
    const parents = new Set<string>();
    for (const session of sessions) {
        const parentKey = (session.parentKey ?? "").trim();
        // 自引用 / 空白 / 父不在结果集 → 该行是顶层，不构成父行
        if (parentKey === "" || parentKey === session.key || !known.has(parentKey)) continue;
        parents.add(parentKey);
    }
    return parents;
}
```

纯函数、两种分组模式通用、可单测。

## 3. 视觉层级

### 3.1 轴对齐（当前最大问题）

现状：父行折叠箭头中心在 `12 + 8 = 20px`；子行却用 `pl-8`（32px）+ 内部 16px rail，
rail 落在 `32 + 8 = 40px`，与箭头不同轴；同时子行内容还带一条 `border-l`，
于是**同一条子行有两条竖线**。

新结构：父子共用 20px 宽的 gutter 列，rail 固定在该列中线。

```
父行  pl-3 ┌ [chevron 20×20]  [star]      [title]        [N]
           │  ↑ 中心 = 12+10 = 22px
子行  pl-3 ┤ [gutter 20px]    [icon]      [title]
           │  rail at left-2.5 (10px) → 22px   ← 同轴
           └─ 短肘 8px 指向内容
```

- 子行 gutter：`relative w-5 shrink-0 self-stretch`
- 竖线：`absolute left-2.5 top-0 h-full w-px bg-border/70`（最后一条子行改成 `h-1/2`）
- 肘：`absolute left-2.5 top-1/2 h-px w-2 bg-border/70`
- 删除子行内容容器上的 `border-l border-border pl-3`。

### 3.2 层级对比

| 维度 | 父行 | 子行 |
|---|---|---|
| 字号 | `text-sm` | `text-[13px]` |
| 标题字重 | `font-medium` | `font-normal` |
| 标题颜色 | `text-primary` | `text-secondary`（hover/选中 → `text-primary`） |
| 底色 | `bg-block-solid` | `bg-transparent`（由组容器提供极淡底色） |
| 行内边距 | `py-2` | `py-1.5` |

### 3.3 折叠控件

- 箭头：20×20 热区，`rounded`，`hover:bg-hover hover:text-accent`；
  图标 `fa-chevron-right` + `transition-transform`，展开时 `rotate-90`（替代换图标）。
- 计数徽标：`rounded`（不再 `rounded-full`）、去掉 `fa-diagram-project` 图标、`tabular-nums`。
  - 折叠时显示 `N`（或筛选命中的 `M/N`，accent 色）。
  - 展开时普通 `N` 隐藏（状态由箭头表达）；命中徽标 `M/N` 仍显示，因为它是筛选信息。

### 3.4 组容器

`renderNode` 把「父行 + 子行容器」包进一个 `div`：

```tsx
<div data-session-key={key} data-depth={node.depth}>
    <SessionRow ... />
    {children.length > 0 ? (
        <div className="bg-surface/20">{children.map(...)}</div>
    ) : null}
    {hidden > 0 ? <ShowAllButton /> : null}
</div>
```

子行本来就在这个容器内渲染，于是展开时整组读作一个块。

## 4. 工具栏按钮

`controls.tsx` 新增 `SubSessionsToggle`，样式复用 `SortButton` 的 28px 方形规格：

```tsx
<SubSessionsToggle
    allExpanded={allExpanded}
    parentCount={allParentKeys.size}
    disabled={allParentKeys.size === 0}
    onToggle={toggleSubSessions}
/>
```

- 图标：未全展开 `fa-angles-down`（点击向下铺开），已全展开 `fa-angles-up`。
- `aria-pressed` + `title`（`Expand all sub-sessions (65)` / `Collapse all sub-sessions`）。
- 位置：`ExpandAllTagsButton` 左侧。

`allExpanded` 判定：`parentCount > 0 && 每个父 key 都在 renderedExpandedParents 里`。

## 5. 改动清单

| 文件 | 改动 |
|---|---|
| `session-tree.ts` | 新增 `collectParentKeys` |
| `session-tree.test.ts` | 覆盖 `collectParentKeys`（正常 / 自引用 / 孤儿父 / 空） |
| `controls.tsx` | 新增 `SubSessionsToggle` |
| `aisessions.tsx` | `subSessionsOverride`、`allParentKeys`、`renderedExpandedParents` 改写、`toggleSubSessions`、`toggleExpandParent` 物化、按钮接线 |
| `session-group.tsx` | 组容器包裹、`isLastChild` 透传、Show all 按钮留在组内 |
| `session-row.tsx` | 新 gutter/rail/肘、层级样式、箭头与徽标 |

## 6. 兼容与回滚

- 纯前端；不改 RPC / SQLite / 生成类型。
- 回滚点：仅这 6 个文件，`git revert` 单个 commit 即可。
- 旧 localStorage 数据（`expandedParents` 非空）仍然有效；「全部收起」负责一次性清理。
