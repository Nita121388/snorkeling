# PRD：Tab 栏启动还原 + 溢出「更多」（block 同款三点图标）

> 状态：planning（本任务当前只落文档，不进入 Phase 2 实现）。
> 技术设计见 `design.md`，执行计划见 `implement.md`。

## 背景与问题

用户的核心诉求只有一句：**每次开 App，Tab 栏要跟上次关掉前一模一样 —— 同样的顺序、同样的激活 Tab，不重排、不隐藏。**

代码事实（已核查）：

- **数据层本来就是对的**。`workspace.tabids` 是持久化的物理顺序，`workspace.activetabid` 是持久化的激活项；
  `emain/emain-window.ts:954` 在 `createBrowserWindow` 里 `bwin.setActiveTab(workspace.activetabid)`。
  所以「关掉前顺序 + 关掉前激活」在存储与启动路径上已经恢复。
- **病根在渲染层**：
  - `frontend/app/tab/tabbar.tsx` 的 `layoutTabIds` 把 pinned（`active` / `openedThisLaunch` / 7 天 `recency`）排到前面，其余排后面。
  - `frontend/app/tab/vtabbar.tsx` 的 `renderOrderedTabIds` + `isHidden` 做同样的分组，并且 **pinned 以外默认折叠**。
  - `openedThisLaunch` 重启即清空 → 每次开机只有「激活」算 pinned → 视觉表现为**激活被挪到最前 + 其余全折叠**，
    完全不符合「关闭前原样」。

同时，水平栏溢出策略是「压窄到 `TabMinWidth=100` → `OverlayScrollbars` 横向滚动」，没有「还有哪些 Tab」的入口。

## 目标

1. 重启后 Tab 栏顺序 = `workspace.tabids` 物理顺序，逐位一致，零重排。
2. 重启后激活 Tab = `workspace.activetabid`，零改写。
3. 两栏都能「按可用空间填满」，放不下的折叠进「更多」。
4. 「更多」触发器外观 = Tab 化 Block 同款 **三点（ellipsis）** 图标 + 计数，替换现有 `fa-layer-group` + 「更多」文字。
5. 明确「启动偏好 / recency 排序」等**不做**，避免范围膨胀。

## 需求

### R1 启动还原（最高优先级）

- Tab 栏渲染顺序严格等于 `workspace.tabids` 物理顺序；**禁止**任何基于 `active` / `openedThisLaunch` / `recency` 的排序或分组前置。
- 激活项由 `workspace.activetabid` 决定，渲染层不得改写它，也不得因为「激活被折叠」而反向调整顺序。
- Go 侧（`pkg/wcore/workspace.go`、`emain/emain-window.ts`）**不改**。数据层已满足需求。

### R2 填满空间 + 溢出进「更多」

- 水平栏（`app:tabbar=top`）：按可用宽度从左到右填，`fit = floor(可用宽 / 每格宽)`；`[0 .. fit-1]` 上栏，其余进「更多」。
- 垂直栏（`app:tabbar=left`）：按可用高度从上到下填，行高 36px（`h-9`）；`[0 .. fit-1]` 上栏，其余进「更多」。
- 窗口锚点固定为 **物理序第 0 个**（不平移）。激活项在窗口外时也进「更多」——这是用户已确认的行为。
- 极端窄/矮窗口下 `fit` 至少为 1。
- 水平栏**取消横向滚动**（不再创建 `OverlayScrollbars` 实例）；垂直栏**取消纵向滚动**（含拖拽到边缘的自动滚动）。

### R3 「更多」触发器

- 图标：`makeIconClass("ellipsis", true)`，与 `frontend/app/block/block.tsx` 的 `inline-tab-block-more-btn` 同款三点。
- 去掉 `fa-layer-group` 图标与垂直栏的「更多」文字。
- 计数徽标 = 折叠进「更多」的 Tab 数；`0` 时不显示数字。
- `count === 0` 时触发器**常驻但降到半透明**（不隐藏），否则菜单里的「新建 Tab / 收起未使用的 Tab」入口不可达。
- 触发器在 sidebar 里保持 `WebkitAppRegion: no-drag`。

### R4 折叠项的可发现性

- **激活项被折叠**时：触发器加 accent 强调（边框或文字色），`title` 提示「激活的 Tab 在更多里」。
- **未读点被折叠**时：触发器加未读提示（红点或强调色数字）。
- 未读 Tab 与激活 Tab 都**不再**享有「强制留在主栏」的特权（与 R2 的物理序填窗一致）。

### R5 不破坏既有行为

- 两栏的点击切换 / 双击重命名 / 右键菜单 / 拖拽重排 / 关闭同步 全部不变。
- 「更多」面板内的搜索过滤、行点击切 Tab、行 `✕` 关 Tab、`Esc` / 点外侧关闭、「新建 Tab」、「收起未使用的 Tab」全部不变。
- `app:tabbar` 设置项语义不变（只影响用哪个栏，不影响排序模型）。
- 拖拽重排只在主栏窗口内可见 Tab 之间进行；被折叠进「更多」的 Tab 不参与拖拽（与现状一致）。

### R6 可维护性

- 两栏共用同一份纯函数：窗口切分 + 溢出计数 + 可见性判定，落在 `frontend/app/tab/tab-more-model.ts`。
- 不再有两栏各自复制的 `isHidden` / 分组排序逻辑。

## 非目标（Non-goals，明确不做）

- ❌ 不按 recency / 最近使用 / 消息数排序。
- ❌ 不做 pinned 前置 / 分组。
- ❌ 不新增「启动偏好」设置项（如 first / last / byRecency）。
- ❌ 不做自定义「启动钉住顺序」（`tab:pinstart` meta）。
- ❌ 不改 `workspace.tabids` / `workspace.activetabid` 的存储格式或 Go/emain 路径。
- ❌ 不改 Tab 内容区、Block 布局、AI 会话、批注。
- ❌ 不改「更多」面板的既有交互与内容（只换触发器外观）。
- ❌ 不实现「更多」行 hover 悬浮 Agent Card（属于 `10-26-tab-more-agent-card`）。

## 验收标准

- [ ] 关 App 前顺序 `[A,B,C,D,E]`、激活 `D` → 重开后顺序仍是 `[A,B,C,D,E]`，激活仍是 `D`。
- [ ] 关 App 前把 `E` 拖到最前 → 重开后仍是 `[E,A,B,C,D]`。
- [ ] 水平栏 20 个 Tab、窗口宽 1200 → 主栏只显示放得下的前 N 个，其余进「更多」，**不出现横向滚动条**。
- [ ] 垂直栏 20 个 Tab、窗口高 700 → 主栏只显示放得下的前 N 个，其余进「更多」，**不出现纵向滚动条**。
- [ ] 激活 Tab 在窗口外时，「更多」触发器有 accent 强调且 `title` 提示；点击菜单里的它可切回并关闭面板。
- [ ] 触发器图标 = block 同款三点；计数 = 折叠数；计数为 0 时触发器半透明常驻。
- [ ] 拖拽重排、双击重命名、右键菜单、关闭 Tab 行为无回归。
- [ ] 单测全绿；`previews/tabbar.preview.tsx`、`previews/vtabbar.preview.tsx` 增加溢出示例。

## 变更控制（防跑偏）

1. **本 PRD 是唯一需求来源**。任何实现与本节冲突，先改 PRD 并取得用户确认，再改代码。
2. 每条需求都必须能映射到一个可观察的验收项；无法验证的需求不进本任务。
3. 分片实施（见 `implement.md`），每片跑完贴验收证据，用户确认后才进下一片。
4. 新想法一律先记到「待评估（Out of scope candidates）」，不在本次顺手做。

### 待评估（不属本次）

- 启动偏好设置（first / last / byRecency）。
- Tab 钉住启动顺序。
- 「更多」行 hover Agent Card（已有独立任务 `10-26-tab-more-agent-card`）。
