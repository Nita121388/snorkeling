# design.md — 技术设计

## 边界

本包只动「前端入口 + 弹窗」这一层，后端 RPC 语义不变（`MoveBlockToTab` / `CopyBlockToTab` /
`MoveBlockToNewTab` / `CopyBlockToNewTab` 四个已存在的方法全部沿用）。

```
                                            ┌─ MoveBlockToNewTab(blockId, srcTabName)   ← New tab 行 + →
block 菜单  Move to Tab…  →  TabTargetModal ─┼─ CopyBlockToNewTab(blockId, srcTabName)   ← New tab 行 + ⧉
                                            ├─ MoveBlockToTab(blockId, targetTabId)     ← tab 行 + 行体/→
                                            └─ CopyBlockToTab(blockId, targetTabId)     ← tab 行 + ⧉
```

**RPC 不需要新增**。四象限在现有四个方法里已经齐了，缺的只是前端把它们暴露成「一个弹窗里的四个落点」。

## 数据结构 / 契约

### `TabTargetModal`（`frontend/app/tab/tab-target-modal.tsx`）新增可选 props

全部可选、全部有默认值 —— 不传时行为与今天**逐字段一致**（`widgets.tsx` 的 Create 弹窗零影响）：

```ts
type TabTargetModalProps = {
    // …既有 9 个字段不变…

    /** 新建入口。传了才渲染 New tab 行；不传 = 与今天完全一样（只有 tab 列表）。 */
    onCreate?: () => Promise<void>;
    /** New tab 行副标题（如 "Named after «Snorkeling»"）。 */
    createHint?: React.ReactNode;
    /**
     * 每行的动作集合。传了 → 行内渲染 N 个 icon 按钮，行体点击 = 第一个动作；
     * 不传 → 走今天的单动作路径（actionLabel / workingLabel / onSelect）。
     */
    rowActions?: TabRowAction[];
    /** 空态文案，默认 "No other tabs"。 */
    emptyLabel?: string;
};

type TabRowAction = {
    /** 稳定 key，"move" / "copy"（单一入口时扩展用）。 */
    key: string;
    /** 按钮悬停/读屏文案，如 "Move to «Design»"。 */
    label: string;
    /** 内联 SVG 或 FontAwesome <i>。 */
    icon: React.ReactNode;
    /** 是否作为行体点击的默认动作。有且只有一个为 true。 */
    primary?: boolean;
    /** 执行；reject 时 modal 展示错误行并恢复。 */
    run: (args: { targetTabId: string }) => Promise<void>;
};
```

### `MoveBlockToTabModal`（`blockframe-header.tsx`）状态收敛

**删掉 `mode` prop 与 `BlockTabActionMode`**（`"move" | "copy"`）：

- 旧：`mode` 由菜单项决定 → 弹窗只有一种动作。
- 新：`mode` 不存在；弹窗同时暴露两个动作，由点击目标决定。
- 标题恒为 `Move Block`（不再随 mode 变）。

`MoveBlockMenuContext` 也相应收敛（删 `onCopyToExistingTab`，保留 `onMoved` / `onCopied` 两个结果回调）。

## 关键实现决策

### D1 行容器 `<button>` → `div[role="button"]`

理由：内层要放两个 `<button>`，嵌套按钮是非法 HTML，点击会串。
项目里同一坑已有记录（`overview-board.tsx:141`）。

- `div[role="button"] tabIndex={0} aria-disabled={disabled}`；
- 行体 `onClick` 执行 `primary` 动作；`onKeyDown` 的 Enter / Space 等价；
- 图标按钮 `onClick` 里 `e.stopPropagation()`；
- 行体点击要判 `e.target === e.currentTarget`？**不需要**——图标已经 stopPropagation 了。
  但**必须**判 `working != null`（正在跑时忽略重复点击）。

### D2 `working` 状态从「行 id」升级为「行 id + 动作 key」

旧状态：`workingTabId: string`（只知道哪一行在跑）。
新状态：`working: { tabId: string; actionKey: string } | null` —— 因为同一行现在有两个动作，
spinner 必须出现在**被点的那个图标**里（原型已验证：替换整个按钮会丢 `data-act`，恢复时认不出是哪个动作）。

`New tab` 行用哨兵 id `"__new__"`（不进 `workspace.tabids`）。

### D3 图标

| 动作 | 图标 | 依据 |
|---|---|---|
| Move | `→` | 项目已有 `fa-arrow-right`（`widgets.tsx` 用作「去」），语义贴「送到那个 tab」 |
| Copy | `⧉` | `fa-copy` / `fa-clone` 二选一，取 `fa-clone`（`fa-copy` 在本项目已大量用于「复制到剪贴板」，会串语义） |

内联 SVG 或 FontAwesome 均可，但**两个图标必须同一套**，不许一个 SVG 一个 icon font。

### D4 hover 浮现 + 键盘可达

```css
.row-icons            { opacity: 0; transition: opacity 120ms ease; }
.tab-target-row:hover .row-icons,
.tab-target-row:focus-within .row-icons { opacity: 1; }
```

`focus-within` 而非 `focus-visible` 的原因：焦点可能落在**行体**上，此时图标仍应可见
（否则键盘用户 Tab 到行体看不到能做什么）。`quality-guidelines.md` 硬约束是「hover 才浮现的
行内动作必须带 `focus-visible:opacity-100`」，`focus-within` 是它的超集，满足要求且更宽。

### D5 入口覆盖：为什么改 `⋯` 而不逐个视图补

现状：

| 入口 | 覆盖面 |
|---|---|
| block header `⋯` | **全 block**（`makeBlockMoveMenuItems` 对任意 `!preview && !ephemeral` 生效） |
| block 框右键 | 全 block，但 `.block-content` 内提前 return |
| 各 view 自己的右键菜单 | 只有 term / vcs / preview-directory / preview-explorer / processviewer 接了 |

结论：**`⋯` 已经是保底入口，漏的是各 view 的右键**。

本包分两步：
1. `⋯` 菜单加守卫单测（锁住「1 条 `Move to Tab…`」）；
2. 给漏接的 view 右键补 `appendBlockMoveMenuItems`（用已有的 helper，不新造机制）。

**不做**统一拦截 `ContextMenuModel`——那会改变所有菜单的行为，超出本包 `touch` 范围。

### D6 新建 tab 的名字

沿用后端 `MoveBlockToNewTab` / `CopyBlockToNewTab` 内部的
`resolveMoveBlockToNewTabBaseName(sourceTab.Name, fallback)` + `MakeUniqueTabName`。
前端只传 `sourceTabName`，不猜名字、不输入。

副标题文案用 `Named after «<sourceTabName>»`（如实反映「名字来自源 tab」，不假装会叫这个名字）。

## 风险与回滚

| 风险 | 处置 |
|---|---|
| `TabTargetModal` 被 `widgets.tsx` 复用，改动波及 Create 弹窗 | 新增全部是可选 prop；加单测断言「不传 `onCreate` / `rowActions` 时不渲染 New tab 行、不提图标」 |
| 行容器 `<button>` → `div` 影响既有 DOM 断言 | 先跑基线（`frontend/app/tab/` + `frontend/app/block/` 225 passed），改完必须 ≥ 该数 |
| 键盘可达性回退 | 行体 `role=button` + `tabIndex=0` + Enter/Space；图标本身是原生 `<button>` |
| 误把 `Copy` 做成破坏性操作 | 语义不变：Move 移走源、Copy 留源；两者都可由用户手工反向操作 |

回滚：本包是**纯前端**、按文件分两次提交（modal 结构 / 菜单与视图覆盖），任一可单独 `git revert`。
无 feature flag（改动是入口收敛，不是新增能力开关）。

## 兼容性

- `move-block-modal` 相关 CSS 类名全部新增（`.new-tab-row` / `.list-divider` / `.row-icons` /
  `.row-icon-btn`），旧的 `.tab-target-action*` 在 `rowActions` 未传时仍被使用 → **不删**。
- 后端零改动 → 无 schema / RPC 兼容问题。
