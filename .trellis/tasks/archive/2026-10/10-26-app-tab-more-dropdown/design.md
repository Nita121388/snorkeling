# Design — Tab 栏「更多」下拉

## 边界

只改前端 `frontend/app/tab/` 与 `frontend/preview/`。不动 Go 侧、不动 `app:tabbar` 设置语义、
不动 Tab 的存储模型（`workspace.tabids` 仍是唯一顺序来源）。

## 模块划分

```
frontend/app/tab/
  tab-more-model.ts     ← 纯函数：行模型 / 可见性判定 / 过滤（可单测，无 React）
  tab-more-menu.tsx     ← 触发器 + 浮层面板（FloatingPortal + floating-ui）
  vtabbar.tsx           ← 宿主 A：底栏左右两区，向上弹
  tabbar.tsx            ← 宿主 B：+ 左侧触发器，向下弹
```

### `tab-more-model.ts`（纯函数，无 React / 无 DOM）

```ts
export interface TabMoreRowInput {
    tabId: string;
    name: string;
    badges?: Badge[] | null;
    agentDots?: TabAgentStatusDot[] | null;
    flagColor?: string | null;
}

export interface TabMoreRow extends TabMoreRowInput {
    isActive: boolean;
    /** 当前在主栏不可见（折叠隐藏 or 水平滚动区外） */
    isHidden: boolean;
    /** 本次启动尚未打开过 → 弱化显示 */
    unopenedThisLaunch: boolean;
    /** 有未阅 agent 状态点 → 不弱化 */
    hasUnreadDot: boolean;
}

export function isTabHiddenFromBar(
    tabId: string,
    ctx: { activeTabId: string; openedThisLaunch: Set<string>; unreadTabIds: Set<string> }
): boolean;

export function buildTabMoreRows(
    tabIds: string[],
    meta: Record<string, Omit<TabMoreRowInput, "tabId">>,
    ctx: { activeTabId: string; openedThisLaunch: Set<string>; unreadTabIds: Set<string>; overflowTabIds?: Set<string> }
): TabMoreRow[];   // 顺序 = tabIds 物理顺序

export function countHiddenRows(rows: TabMoreRow[]): number;

export function filterTabMoreRows(rows: TabMoreRow[], query: string): TabMoreRow[];
// trim + toLowerCase + 子串匹配；空 query 原样返回
```

判定口径与两栏现有的 `isHidden` **完全一致**，避免出现"下拉说隐藏、主栏却显示"的不一致：

```
hidden = !isActive && !openedThisLaunch.has(id) && !unreadTabIds.has(id) && !overflowVisible
```

### `tab-more-menu.tsx`

```ts
interface TabMoreMenuProps {
    tabIds: string[];
    activeTabId: string;
    placement: "top-end" | "bottom-end";   // 垂直栏向上 / 水平栏向下
    hiddenCount: number;
    variant: "vertical" | "horizontal";    // 只影响触发器外观
    onActivateTab: (tabId: string) => void;
    onCloseTab: (tabId: string) => void;
    onNewTab: () => void;
    onCollapseInactive: () => void;
    /** 面板开关回调：宿主用来压住 hover 自动展开 */
    onOpenChange?: (open: boolean) => void;
}
```

内部结构：

- `TabMoreMenuTrigger`：`<button aria-haspopup="menu" aria-expanded>` + 计数徽章；
- `TabMoreMenuPanel`：`useFloating({ open, onOpenChange, placement, middleware: [offset(6), flip(), shift({padding:8}), size({apply: maxHeight 60vh})], whileElementsMounted: autoUpdate, elements: { reference } })` + `useDismiss`；
- 行 `TabMoreRowItem`：badges / 名称 / 关闭按钮；
- 每个 row 的数据通过 `useTabVisualMeta(tabId)` 从 `env.wos` + `getTabBadgeAtom` + `getTabAgentStatusDotsAtom` 读取，与 `VTabWrapper` 同一套来源。

`tabIds` 数量 > `TabSearchThreshold = 12` 时显示搜索框；输入即时 `filterTabMoreRows`。

## 宿主接入

### 垂直栏 `vtabbar.tsx`

底栏由单个 `+ New Tab` 改为一行两区：

```
[ ⧉ 更多 · N ]  [ + ]
```

- 「更多」占 `flex-1`，`onClick` 切换面板；弹出 `placement="top-end"`。
- 「+」保留 `env.electron.createTab()`，宽度固定，`aria-label="New Tab"`。
- 面板打开时 `setForcedTabBarHovered(true)`（新增 state 并入 `isHidden` 判定的 `||` 链），
  关闭时回落并保留原有 `hideHoverTimerRef` 2s 延时，避免主栏抖动。

### 水平栏 `tabbar.tsx`

- 在 `addBtnRef` 的 `+` **之前**插入触发器 `ref={moreBtnRef}`，`placement="bottom-end"`。
- `setSizeAndPosition()` 的 `nonTabElementsWidth` 增加 `moreBtnWidth`，否则 Tab 会被遮挡。
- 面板打开时把 `isMoreMenuOpen` 并入 `visibleTabIds` 的展开条件（避免面板下方 Tab 突然被折叠消失）。

## 数据流

```
workspace.tabids ─┐
activeTabId       ├─→ buildTabMoreRows ─→ 面板列表
openedThisLaunch  │
unreadTabIds      ┘
```

无新增 store、无新增 RPC。

## 风险与对策

| 风险 | 对策 |
|---|---|
| 水平栏宽度漏算导致 Tab 被遮挡 | `nonTabElementsWidth` 显式加入 `moreBtnWidth`；`visual regression` 用 preview 12-tab 示例人工核对 |
| 面板打开与 hover 展开互相打架 | 面板开 → 宿主置 forced-hover = true；面板关 → 走原有延时恢复 |
| 浮层随 OverlayScrollbars 漂移 | reference 绑定到固定按钮（在滚动容器外），不是滚动区 |
| 关闭 Tab 的二次确认逻辑再复制一份 | 两栏各自已有 `handleCloseTab`/内联块，面板通过 `onCloseTab` 回调注入，不在面板内实现确认 |
| 虚拟滚动/拖拽受影响 | 面板不改变 DOM 结构，只新增按钮与 Portal 浮层 |

## 回滚

单 PR 纯新增 + 两处宿主小改；回滚只需 revert 该 commit，无数据/配置迁移。
