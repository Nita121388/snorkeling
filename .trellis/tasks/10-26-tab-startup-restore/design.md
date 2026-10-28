# Design — Tab 栏启动还原 + 溢出「更多」

> 配套 `prd.md`。本文件只描述技术边界、契约、算法与风险，不含实现代码。

## 1. 边界

### 会改

```
frontend/app/tab/
  tab-more-model.ts          纯函数：可见窗口切分 / 溢出计数 / 行模型
  tab-more-menu.tsx          仅触发器和计数展示（图标 + 高亮）
  tabbar.tsx                 水平栏：删分组重排、删横向滚动、用窗口切分布局
  vtabbar.tsx                垂直栏：删分组重排、删纵向滚动、用窗口切分布局
  tab-more-model.test.ts     窗口切分 / 计数的单测
  tab-more-menu.dom.test.tsx 触发器与行渲染的 DOM 契约
frontend/preview/previews/
  tabbar.preview.tsx         增加 20 Tab 溢出示例
  vtabbar.preview.tsx        增加 20 Tab 溢出示例
```

### 不改

```
pkg/wcore/workspace.go          数据层已正确恢复 activetabid
emain/emain-window.ts           启动路径 setActiveTab(workspace.activetabid) 已存在
schema/settings.json            不新增设置项
frontend/app/tab/tab-open-state.ts   openedThisLaunch 保留（供「收起未使用」判定），但不再参与可见性
```

## 2. 现状事实（作为设计前提）

| 事实 | 位置 |
|---|---|
| 顺序源 = `workspace.tabids`，持久化 | `pkg/waveobj/wtype.go` / `pkg/wcore/workspace.go` |
| 激活源 = `workspace.activetabid`，持久化 | 同上；启动 `emain-window.ts:954` 恢复 |
| 水平栏常量 `TabDefaultWidth=130`、`TabMinWidth=100` | `tabbar.tsx:44-45` |
| 垂直栏行高 36px（`h-9`） | `frontend/app/tab/vtab.tsx` |
| 旧的 pinned 分组 = `tab-pinned-order.ts` 的 `partitionAndOrderTabs` / `isPinnedTab` | 本次目标为删除其在渲染路径上的使用 |
| 「更多」现有可见性判定 `isTabHiddenFromBar` 含 `openedThisLaunch` | `tab-more-model.ts` |

## 3. 契约：纯函数（`tab-more-model.ts`）

```ts
/** 一栏的布局输入（水平/垂直共用，单位由调用方决定）。 */
export interface TabBarWindowInput {
    tabIds: readonly string[];      // 物理顺序，必须已过滤无效 id
    capacity: number;               // 可用空间（水平 px 宽 / 垂直 px 高）
    itemSize: number;               // 单个 Tab 的主轴尺寸（水平格宽 / 垂直行高）
    minItemSize: number;            // 水平下限 100；垂直即行高
    maxItemSize: number;            // 水平上限 130；垂直即行高
    pillSize: number;               // 「更多」触发器占用（水平按宽；垂直按高）
}

export interface TabBarWindow {
    /** 上栏的顺序（物理序前缀，不含被折叠项）。 */
    visibleTabIds: string[];
    /** 折叠进「更多」的顺序（物理序后缀）。 */
    hiddenTabIds: string[];
    /** 实际使用的单格尺寸（水平会被拉伸/压缩到该值）。 */
    itemSize: number;
    /** 触发器计数 = hiddenTabIds.length。 */
    hiddenCount: number;
}

export function computeTabBarWindow(input: TabBarWindowInput): TabBarWindow;
```

### 算法（唯一实现，两栏共用）

```
N = tabIds.length
if N === 0: return { visible: [], hidden: [], itemSize: minItemSize, hiddenCount: 0 }

// 1) 先假设不需要 pill，算一个「自然」单格尺寸
natural = clamp(capacity / N, minItemSize, maxItemSize)      // 水平
                                             // 垂直：固定 36，clamp 退化为恒等
// 2) 全部放得下？
if natural * N <= capacity:
    return { visible: tabIds, hidden: [], itemSize: natural, hiddenCount: 0 }

// 3) 需要 pill：扣掉 pill 后能放几个
avail = max(0, capacity - pillSize)
fit = clamp(floor(avail / natural), 1, N - 1)   // 至少 1；至少给 pill 留 1 个
// 4) 用剩余空间把可见项拉满（只往大拉，不超过 max）
itemSize = clamp(avail / fit, minItemSize, maxItemSize)

return {
    visibleTabIds: tabIds.slice(0, fit),
    hiddenTabIds:  tabIds.slice(fit),
    itemSize,
    hiddenCount: N - fit,
}
```

性质（可直接写成单测）：

- `visibleTabIds` 永远是 `tabIds` 的**前缀**，`hiddenTabIds` 是**后缀**，拼接后恒等于 `tabIds`（顺序守恒）。
- `hiddenCount === 0` ⟺ 全部放得下 ⟺ `fit === N`。
- `1 <= visibleTabIds.length <= N`（`N > 0` 时）。
- 与 `active` / `openedThisLaunch` / `recency` **完全无关**（纯函数签名里根本没有它们）。
- 单调性：`capacity` 增大 → `hiddenCount` 不增。

## 4. 可见性与「更多」行模型

`isTabHiddenFromBar` 的语义从「折叠判定」改为「是否在窗口外」：

```
旧：hidden = !active && !openedThisLaunch && !unread && !collapsed
新：hidden = hiddenTabIds.has(tabId)          // 由 computeTabBarWindow 单点决定
```

`TabMoreRow` 字段调整：

| 字段 | 变化 |
|---|---|
| `isHidden` | 改为「在窗口外」 |
| `unopenedThisLaunch` | **保留字段用于弱化样式**，但不再影响 `isHidden` |
| `hasUnreadDot` | 保留，仅用于「不强弱化 + 药丸未读提示」 |
| `isManuallyCollapsed` | 保留；`collapsedTabIds` 在**窗口切分前**先被剔除出主栏候选 |

`collapsedTabIds`（用户点「收起未使用的 Tab」）的处理：在计算窗口前，把 `collapsedTabIds` 从 `tabIds` 里摘出，直接并入 `hiddenTabIds`，其余按物理序切窗。这样「手动收起」与「放不下」共用一条「进更多」的通道，不额外引入第二套排序。

## 5. 触发器规格

| 项 | 规格 |
|---|---|
| 图标 | `makeIconClass("ellipsis", true)`（block 同款三点） |
| 文案 | 无（删除「更多」两字；`title`/`aria-label` 承载语义） |
| 计数 | `hiddenCount > 0` 时显示数字，样式对齐 block 的 `.more-count`（10px） |
| 空态 | `hiddenCount === 0` → 半透明常驻（opacity ~0.5），不隐藏 |
| 激活在更多里 | 触发器加 accent（`text-accent` 或 1px accent 边框），`title` = 「激活的 Tab 在更多里」 |
| 未读在更多里 | 触发器计数旁加红点，`title` 追加未读条数 |
| 拖拽区 | `WebkitAppRegion: no-drag` 保持 |

## 6. 两栏接入点

### 水平栏 `tabbar.tsx`

1. 删除 `layoutTabIds` 的 pinned/hidden 分组分支，改为：
   - `const win = computeTabBarWindow({ tabIds: orderedTabIds, capacity: spaceForTabs, itemSize: TabDefaultWidth, minItemSize: TabMinWidth, maxItemSize: TabDefaultWidth, pillSize: moreBtnWidth })`
   - `visibleTabIds = win.visibleTabIds`，宽度统一 `win.itemSize`，`translate3d(index * itemSize)`。
2. 删除 `OverlayScrollbars` 实例的创建/销毁（`osInstanceRef`、`OSOptions` 中的 x scroll），保留 ref 供其它逻辑读取与否自行清理。
3. `moreMenuWrapRef` 宽度参与 `spaceForTabs` 计算；窗口切分后 pill 宽变化 → 用现有 `ResizeObserver` 触发一次重算（防自激：先算窗再量 pill，或 pill 宽取稳定常量）。
4. `saveTabsPosition` / 拖拽落点计算继续用窗口内可见 Tab 的序号。

### 垂直栏 `vtabbar.tsx`

1. 删除 `renderOrderedTabIds` 的分组逻辑，改为 `orderedTabIds` 直接进 `computeTabBarWindow`。
2. 可用高 = 滚动容器 `clientHeight`（已扣除 `MacOSHeader`、`SessionOverviewButton`、底栏 `h-9`）。
3. 删除 `overflow-y-auto` 与 `updateScrollFromDragY` 的滚动行为；容器保留 `overflow-hidden`。
4. `hidden` 传参改为 `!visibleTabIdsSet.has(tabId)`；`max-h-0` 折叠动画保留（视觉不变）。

## 7. 与旧逻辑的取舍

| 旧逻辑 | 处置 | 理由 |
|---|---|---|
| `partitionAndOrderTabs` / `isPinnedTab` | 从渲染路径移除；`tab-pinned-order.ts` 若无其他引用则删除 | 与「关闭前原样」直接冲突 |
| `tabRecencyStore` | 保留存储（不删数据、不动 localStorage key），但**不再驱动排序** | 删除会丢用户数据、扩大改动面；留待后续任务决定 |
| `openedThisLaunch` | 保留（`tab-more-model` 弱化样式 + 「收起未使用」判定仍用） | 复用现有语义，不扩大改动面 |
| 水平横滚 / 垂直纵滚 | 删除滚动行为 | 与「溢出进更多」互斥 |
| hover 展开折叠组 | 删除 | 没有「默认隐藏组」了 |

## 8. 风险与回滚

| 风险 | 表现 | 缓解 |
|---|---|---|
| 窗口切分自激振荡 | Tab 在 visible/hidden 间反复闪 | pill 宽用稳定测量（先固定 `display:flex` 再量一次）；切分只在 `ResizeObserver` 回调里重算，不在渲染期改 DOM |
| 拖拽重排错位 | 落点算到 hidden Tab | 拖拽只用 `visibleTabIds` 的序号；hidden 不参与 |
| 激活项不可见造成误解 | 主栏无高亮 | R4 的药丸 accent + tooltip |
| 与 `10-26-tab-more-agent-card` 同文件冲突 | `tab-more-menu.tsx` / `tab-more-model.ts` 改动互相覆盖 | **本任务排在其后**，或该任务先合并再开本任务的片 1 |
| `tab-pinned-order.ts` 仍有其它引用 | 删除导致编译失败 | 先在片 2 用 `rg` 确认零引用再删 |
| 滚动删除影响 `scrollIntoView` 跟随 | 切 Tab 不再自动滚入 | 已由「前缀窗口」替代；激活项在窗口外时只高亮药丸，不滚动 |

**回滚**：每一片独立 commit；出问题时按片 revert，不影响其它片。数据层零改动 ⇒ 回滚不会破坏 `workspace.tabids` / `activetabid`。

## 9. 依赖与顺序

```
10-26-tab-more-agent-card（同文件，进行中）
        │  先落地并提交
        ▼
本任务 片 1（图标）→ 片 2（去重排）→ 片 3（窗口切分）→ 片 4（清理 + 测试）
```

若用户要求并行，则本任务的片 1/2 必须 rebase 到该任务之后，且 `tab-more-model.ts` 的改动需人工合并（禁止盲目覆盖）。
