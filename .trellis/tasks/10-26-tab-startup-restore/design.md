# Design — Tab 栏启动还原 + 溢出「更多」

> 配套 `prd.md`。本文件只描述技术边界、契约、算法与风险，不含实现代码。

## 1. 边界

### 会改

```
emain/emain-window.ts           createBrowserWindow 恢复路径：标记 workspace.tabids 全部为已打开（首片）
emain/emain-window.test.ts      恢复标记的单测
frontend/app/tab/
  tab-more-model.ts          纯函数：可见窗口切分 / 溢出计数 / 行模型
  tab-more-menu.tsx          仅触发器和计数展示（图标 + 高亮）
  tabbar.tsx                 水平栏：删分组重排、删横向滚动、用窗口切分布局
  vtabbar.tsx                垂直栏：删分组重排、删纵向滚动、用窗口切分布局
  tab-more-model.test.ts     窗口切分 / 计数的单测
  tab-more-menu.dom.test.tsx 触发器、行渲染与恢复动作的 DOM 契约
  tab-collapse-state.ts      手动隐藏状态持久化 + 跨 renderer 同步 + 关闭清理
  tabcontextmenu.ts          单 Tab 隐藏 / 恢复入口
  tab-collapse-state.test.ts 持久化、同步、恢复与关闭清理测试
frontend/preview/previews/
  tabbar.preview.tsx         增加 20 Tab 溢出示例
  vtabbar.preview.tsx        增加 20 Tab 溢出示例
scripts/verify/tab-startup-restore/  首片真机验证台（复制 _template，能力只从 lib/ 拿）
scripts/verify/README.md     area 登记表新增一行
```

### 不改

```
pkg/wcore/workspace.go / pkg/waveobj/   Go 数据层不改（tabids / activetabid 已正确持久化）
schema/settings.json            不新增设置项
frontend/app/tab/tab-open-state.ts   openedThisLaunch 语义不变；仅由恢复路径提前写入
```

## 2. 现状事实（作为设计前提）

| 事实 | 位置 |
|---|---|
| 顺序源 = `workspace.tabids`，持久化 | `pkg/waveobj/wtype.go` / `pkg/wcore/workspace.go` |
| 激活源 = `workspace.activetabid`，持久化 | 同上；启动 `emain-window.ts:954` 恢复 |
| 水平栏常量 `TabDefaultWidth=130`、`TabMinWidth=100` | `tabbar.tsx:44-45` |
| 垂直栏行高 36px（`h-9`） | `frontend/app/tab/vtab.tsx` |
| 旧的 pinned 分组 = `tab-pinned-order.ts` 的 `partitionAndOrderTabs` / `isPinnedTab` | 本次目标为删除其在渲染路径上的使用 |
| 「更多」现有可见性判定 `isTabHiddenFromBar` 含 `openedThisLaunch` | `tab-more-model.ts:74-84` |
| 重启后 `openedThisLaunch` 只含激活 Tab → 非激活全判隐藏、且被灰化 | `tab-open-state.ts:13` / `tab-more-model.ts:84` / `tab.tsx:207` / `vtab.tsx:172` |
| 全部开窗路径汇聚 `createBrowserWindow` | `emain-window.ts:935`（调用点：`emain.ts:109`、`emain-window.ts:926/1168/1184/1227`、`emain-wsh.ts:72`） |
| 手动收起当前仅为 renderer 内存 atom，重启即清空；打开该 Tab 会自动展开 | `tab-collapse-state.ts` / `tab-open-state.ts` |

## 2.5 首片（片 0）设计：启动恢复全部 Tab（本次交付）

### 机制

在 `createBrowserWindow`（`emain/emain-window.ts:935`，全部开窗路径的唯一汇聚点）取到 workspace 之后、
`bwin.setActiveTab(workspace.activetabid, ...)` 之前，把 `workspace.tabids` 逐个
`markTabOpenedThisLaunch(tabId)`（可抽成小函数便于单测）：

- **时机**：必须早于首个 Tab renderer 初始化 —— renderer 经同步 IPC `getOpenedThisLaunchTabIds`
  （`emain/preload.ts:62` → `tab-open-state.ts:13`）在 atom 创建时读集合，先标记即可让首个窗口读到全量；
  此时 `allLoadedTabViews` 为空，`broadcastOpenedThisLaunchTabIds` 是 no-op，无时序竞态。
- **覆盖**：一处改动覆盖所有恢复路径 —— 启动还原 `emain.ts:109`、relaunch `:1227`、重建/新窗
  `:1168/:1184`、跨 workspace 开窗 `:926`、wsh 开窗 `emain-wsh.ts:72`。
- **纯增量**：不改 `workspace.tabids` / `activetabid`、不改 Go、不改可见性模型 `isTabHiddenFromBar`
  本身、不改布局分组代码。

### 为什么选「emain 标记」而不是「前端默认可见」

| 方案 | 结果 |
|---|---|
| A（本片）：恢复时把 tabids 全部 `markTabOpenedThisLaunch` | 可见性（`tab-more-model.ts:84`）、灰化（`tab.tsx:207` / `vtab.tsx:172` / `tab-more-model.ts:118`）、水平布局分组（`tabbar.tsx:341`）三处同时归位 —— 分组成员条件与可见性条件同构，全标记后 `layoutTabIds` 恒等于物理序。改动集中在一个函数。 |
| B：改 `isTabHiddenFromBar` 默认可见 | 灰化与「更多」行弱化仍按 `openedThisLaunch` 判 → 重启后全灰；要么再引入「已恢复」新概念，要么删掉灰化语义 —— 改动面反而更大，且与「本次启动是否打开过」的既有语义冲突。 |

### 已知副作用（接受）

- 「收起未使用的 Tab」（`tabbar.tsx:988` `onCollapseInactive`、`vtabbar.tsx:371`
  `collectVTabCollapseTargets`）的目标 = 非激活 && openedThisLaunch && 无未读 → 重启后立即点击会
  收起全部非激活 Tab（此前是空操作）。语义从「本启动点过」放宽为「已恢复/已打开」，与按钮用途
  一致，接受；若体验不佳，记入 PRD 待评估，后续片单独收紧。
- 恢复的 Tab 不再灰化 —— 正是本片目标。
- `workspace.tabids` 中的悬空 id / session-overview 过滤项被标记无副作用（仅进 Set）。

### 首片不改

`isTabHiddenFromBar` / `selectBarVisibleTabIds` 判定本身、`tab-pinned-order.ts`、横向/纵向滚动、
「更多」触发器外观、手动隐藏持久化 —— 全部留后续片（见 §9）。

## 2.6 片 0.5a 设计：拖拽误判修复（R8）

新纯函数模块 `frontend/app/tab/tab-drag-model.ts`：

- `shouldEngageDrag` / `isBeyondEngageThreshold`：engage = 位移 ≥8px（按 zoomFactor 折算）
  **且**连续 2 次 mousemove 越过阈值（旧实现 5px 单帧，过于敏感）；持久化阈值
  `DragPersistThresholdPx = 50` 保持不变。
- `computeDragDirection(currentX, prevX, prevDirection)`：与旧语义一致，首帧返回 null；
  状态从模块级变量（`tabbar.tsx:233` 旧）移入 `draggingTabDataRef`。
- `computeNewTabIndex({ currentX, tabWidth, dragDirection, order, draggedTabId, startPositions })`：
  落点比较用 `Map<tabId, 位置>`（mousedown 实时测量），消灭「索引在 splice 后错位」
  与「stale dragStartPositions」两类错判。

`tabbar.tsx` 接入：

- `handleDragStart`：实时测量各可见 Tab 的 `rect.left - tabsWrapper.left` 存入 ref
  （不再读 `dragStartPositions` state；该 state 与 `saveTabsPosition` 一并删除）。
- `handleMouseMove`：未 engage 前不写任何状态/样式；engage 后在 `workingOrder`
（`[...tabIds]` 副本）上换位；**不再原地 splice React state**。
- `handleMouseUp`：`dragged === true` 才 `setTabIds(workingOrder)` + 落盘
（`setUpdatedTabsDebounced(workingOrder)`）；否则仅视觉复位（现有 `setSizeAndPosition` 分支）。

## 2.7 片 0.5b 设计：切换点击响应（R9 A/B）

- **A 乐观高亮**：新 `frontend/app/tab/tab-optimistic-active.ts`：
  `optimisticActiveTabIdAtom`（renderer 内存）+ `setOptimisticActiveTab`（带 2s 超时自清）
  + `clearOptimisticActiveTab` + `useHighlightTabId(staticTabId)`（乐观值优先）。
  两栏的 Tab `active` 视觉 prop 改用 highlight 值；`activeTabId`（staticTabId）继续驱动
  关闭确认、可见性 ctx、布局分组等非视觉逻辑。确认清除：`workspace.activetabid === 乐观值`
  时 effect 清除（后端广播到达）。
- **B 双入队去重**：`WaveBrowserWindow.isTabSwitchInFlight(tabId)` 检查 `actionQueue`
  （含正在执行的 [0]，shift 在 finally）是否有同目标 switchtab；`emain.ts` 的
  `electron:updateactivetab` 处理器在去重命中时直接 return，不再入队。
- **不做（后续片）**：队列感知最新意图/已加载 Tab 插队（C）、`reinitWave` 减负（D）
  —— 先靠 `[tabswitch]` 日志拿数据。

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
    manuallyHiddenTabIds: ReadonlySet<string>; // 仅手动隐藏；不含自动空间溢出
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

### 手动隐藏状态契约

- 将 `collapsedTabIdsAtom` 的语义收窄并明确为用户主动隐藏状态；单个隐藏与「收起未使用的 Tab」批量动作都写入同一持久化集合。
- 存储使用 renderer 可共享的 `localStorage` 持久化 atom，跨 renderer 通过 `storage` 事件同步；启动时读回集合。持久化值必须是 JSON 可逆的数据（如 `string[]`），不能直接 JSON 序列化 `Set`；需要 Set 视图时由派生 atom 转换。
- Tab ID 是持久化键值；任何 Tab 关闭/删除成功的既有路径必须调用 `removeTab`，移除对应隐藏记录。发现需要多个关闭路径时，在实现前梳理实际调用点并逐一接入，不做定时清理或按 workspace 不完整列表误删仍存活 Tab 的启发式清扫。
- 打开被手动隐藏的 Tab 沿用 `tab-open-state.ts` 当前 `expandCollapsedTabId` 行为；菜单中的恢复动作直接移除单个 ID，不激活 Tab。
- 自动窗口溢出只由物理顺序与容量计算得出，不写入持久化集合；容量变化只会改变自动溢出，不会影响手动隐藏集合。

### 算法（唯一实现，两栏共用）

```
manualHidden = tabIds.filter(id => manuallyHiddenTabIds.has(id))
candidates = tabIds.filter(id => !manuallyHiddenTabIds.has(id))
N = candidates.length
avail = max(0, capacity - pillSize) // 触发器常驻，始终先为它留空间
if N === 0: return { visible: [], hidden: manualHidden, itemSize: minItemSize, hiddenCount: manualHidden.length }
natural = clamp(avail / N, minItemSize, maxItemSize)
if natural * N <= avail:
    visibleCandidates = candidates
    automaticOverflowIds = []
else if N === 1:
    // 不把唯一未手动隐藏的 Tab 也自动塞进「更多」；空间极端不足时允许主栏溢出。
    visibleCandidates = candidates
    automaticOverflowIds = []
    itemSize = minItemSize
else:
    fit = min(N - 1, max(1, floor(avail / max(natural, 1))))
    visibleCandidates = candidates.slice(0, fit)
    automaticOverflowIds = candidates.slice(fit)
    itemSize = clamp(avail / fit, minItemSize, maxItemSize)
// 两类隐藏 ID 最终按原 tabIds 物理序合并
hiddenTabIds = tabIds.filter(id => manuallyHiddenTabIds.has(id) || automaticOverflowIds.includes(id))
```

性质（可直接写成单测）：

- 在排除手动隐藏项后，`visibleTabIds` 是候选列表的物理序**前缀**，自动溢出是其后缀；最终 `hiddenTabIds` 按原始 `tabIds` 顺序合并手动隐藏与自动溢出，`visible ++ hidden` 不要求整体拼回原序，但二者无重复且并集等于输入。
- `hiddenCount === 0` ⟺ 全部放得下 ⟺ `fit === N`。
- 有未手动隐藏候选时至少显示一个（除非这些候选为空，即用户手动隐藏了全部 Tab）；`N > 0` 且窗口极端窄时允许以最小尺寸溢出容器，仍保留一个可见 Tab。
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
| `isManuallyCollapsed` | 保留；持久化的 `collapsedTabIds` 在**窗口切分前**先被剔除出主栏候选 |
| `canRestore` | 手动隐藏行显示「显示在 Tab 栏」动作；自动溢出行不显示手动恢复动作 |

`collapsedTabIds`（用户单独隐藏或点「收起未使用的 Tab」）的处理：窗口计算前从候选列表摘出，直接并入 `hiddenTabIds`；其余候选按物理序切窗。两类隐藏项都从「更多」可达，但行模型保留 `isManuallyCollapsed`，只有手动隐藏行提供恢复按钮。

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

### 单 Tab 菜单与「更多」恢复入口

- `tabcontextmenu.ts` 在 Tab 右键菜单增加「从 Tab 栏隐藏」动作，调用共享状态 store；不触发 close、select 或 workspace reorder。
- `tab-more-menu.tsx` 对 `isManuallyCollapsed` 行增加独立的「显示在 Tab 栏」按钮/菜单动作；阻止事件冒泡，避免同次点击激活 Tab。
- 主栏隐藏一个 Tab 后即刻重算窗口；手动恢复仅清除隐藏 ID，再按物理顺序和当前容量重算。

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
| `openedThisLaunch` | 保留用于新 Tab 样式与「收起未使用」目标判定，不再参与排序/可见性 | 复用现有语义 |
| 用户手动隐藏集合 | 改为持久化 + renderer 间同步；Tab 删除时清理 | 实现用户明确要求的跨重启隐藏偏好 |
| 自动空间溢出 | 不持久化 | 窗口尺寸可能变化，启动时应按当前空间重新计算 |
| 水平横滚 / 垂直纵滚 | 删除滚动行为 | 与「溢出进更多」互斥 |
| hover 展开折叠组 | 删除 | 没有「默认隐藏组」了 |

## 8. 风险与回滚

| 风险 | 表现 | 缓解 |
|---|---|---|
| 窗口切分自激振荡 | Tab 在 visible/hidden 间反复闪 | pill 宽用稳定测量（先固定 `display:flex` 再量一次）；切分只在 `ResizeObserver` 回调里重算，不在渲染期改 DOM |
| 拖拽重排错位 | 落点算到 hidden Tab | 拖拽只用 `visibleTabIds` 的序号；hidden 不参与 |
| 激活项不可见造成误解 | 主栏无高亮 | R4 的药丸 accent + tooltip |
| 与 `10-26-tab-more-agent-card` 同文件冲突 | `tab-more-menu.tsx` / `tab-more-model.ts` 改动互相覆盖 | **本任务排在其后**，或该任务先合并再开本任务的片 1 |
| 手动隐藏状态有多个 renderer / Tab 删除路径 | 状态分叉或遗留已删除 ID | 单例 storage + storage 事件；实现前盘点删除路径并覆盖测试 |
| `tab-pinned-order.ts` 仍有其它引用 | 删除导致编译失败 | 先在片 2 用 `rg` 确认零引用再删 |
| 滚动删除影响 `scrollIntoView` 跟随 | 切 Tab 不再自动滚入 | 已由「前缀窗口」替代；激活项在窗口外时只高亮药丸，不滚动 |

**回滚**：每一片独立 commit；出问题时按片 revert，不影响其它片。Tab 顺序/激活的数据格式不改；若回滚手动隐藏实现，需明确 renderer 本地持久化记录的兼容策略（不得意外把用户隐藏选择迁移成 workspace 顺序变化）。

## 9. 依赖与顺序

```
```
片 0（启动恢复全部 Tab，本次交付）
        ▼
片 1（三点触发器）→ 片 2（去分组重排）→ 片 3（窗口切分 + 持久化手动隐藏/恢复）→ 片 4（清理 + 测试）
```

10-26-tab-more-agent-card 已归档；实施前检查相关文件无后续未提交改动。
```

若用户要求并行，则本任务的片 1/2 必须 rebase 到该任务之后，且 `tab-more-model.ts` 的改动需人工合并（禁止盲目覆盖）。
