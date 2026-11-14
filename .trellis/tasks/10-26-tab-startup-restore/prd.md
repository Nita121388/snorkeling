# PRD：Tab 栏启动还原 + 溢出「更多」（block 同款三点图标）

> 状态：planning（本任务当前只落文档，不进入 Phase 2 实现）。
> 技术设计见 `design.md`，执行计划见 `implement.md`。
> **首片交付（用户指示）：先实现「重启后默认恢复上次打开的全部 Tab，而不是只显示一个」= R1。R2–R7 随后续片交付。**

## Goal

重启 App 后，主栏原样恢复上次打开的全部 Tab —— 顺序等于 `workspace.tabids` 物理序、激活等于 `workspace.activetabid`、全量可见且不灰化，而不是只显示激活的那一个；后续片补齐溢出「更多」、三点触发器与手动隐藏跳重启。

## 背景与问题

用户的核心诉求：**每次开 App，Tab 顺序、激活项与「哪些 Tab 打开着」都还原到关闭前的状态；用户明确手动隐藏的 Tab 也要继续留在「更多」里。** 自动空间溢出则按启动后的窗口尺寸重新计算。

代码事实（已核查，锚点可复核）：

- **数据层是对的**：`workspace.tabids` 持久化物理顺序、`workspace.activetabid` 持久化激活项
  （`pkg/waveobj/wtype.go`、`pkg/wcore/workspace.go:425`）；启动恢复激活的调用在
  `emain/emain-window.ts:955`（`bwin.setActiveTab(workspace.activetabid, ...)`）。
  所有开窗路径都汇聚到 `createBrowserWindow`（`emain/emain-window.ts:935`）：启动还原 `emain/emain.ts:109`、
  relaunch 循环 `emain/emain-window.ts:1227`、重建首窗 `:1168`、新窗 `:1184`、跨 workspace 开窗 `:926`、
  wsh 开窗 `emain-wsh.ts:72`。
- **「只打开一个 Tab」的病根在渲染层可见性判定**：`frontend/app/tab/tab-open-state.ts:13` 的
  `openedThisLaunchTabIds` 启动时为空（只随激活/创建追加）；`frontend/app/tab/tab-more-model.ts:74`
  `isTabHiddenFromBar` 的兜底 `return !ctx.openedThisLaunch.has(tabId)`（`:84`）→ 重启后非激活、无未读、
  未手动收起的 Tab 全部判隐藏；`selectBarVisibleTabIds`（`tab-more-model.ts:94`，水平栏接入
  `tabbar.tsx:246`、垂直栏 `vtabbar.tsx:398`）于是只留下激活 Tab —— 主栏看起来「只打开一个 Tab」，
  其余全部只存在于「更多」下拉。
- 同一集合还驱动灰化与弱化：`tab.tsx:207`（`unopened-this-launch` 类）、`vtab.tsx:172`
  （`opacity-45 grayscale`）、`tab-more-model.ts:118`（「更多」行弱化）。所以仅把 Tab 强行显示出来
  还不够 —— 重启后它们会是灰的。
- 水平栏布局分组（`tabbar.tsx:341-355`，active/opened/unread 前置 + `hiddenTabs` 后缀）当前是 no-op：
  `visibleTabIds` 成员必然满足分组条件，`hiddenTabs` 恒为空；锚点保留，后续片仍会清理。
- 水平栏溢出策略是「压窄到 `TabMinWidth=100` → `OverlayScrollbars` 横向滚动」，没有「还有哪些 Tab」
  的入口（R2 后续片处理）。

## 目标

1. （首片 · R1）重启后主栏默认显示上次关闭前的全部 Tab：顺序 = `workspace.tabids` 物理顺序、
   激活 = `workspace.activetabid`、无灰化、「更多」计数 0。
2. 两栏都能「按可用空间填满」，自动放不下的 Tab 折叠进「更多」。
3. 用户可单独手动隐藏/恢复 Tab；手动隐藏状态跨重启保留，并与自动空间溢出区分。
4. 「更多」触发器外观 = Tab 化 Block 同款 **三点（ellipsis）** 图标 + 计数，替换现有
   `fa-layer-group` + 「更多」文字。
5. 明确「启动偏好 / recency 排序」等**不做**，避免范围膨胀。

## 需求

### R1 启动还原（首片交付，最高优先级）

- **R1.1 顺序**：Tab 栏渲染顺序严格等于 `workspace.tabids` 物理顺序；**禁止**任何基于
  `active` / `openedThisLaunch` / `recency` 的排序或分组前置。
- **R1.2 激活**：激活项由 `workspace.activetabid` 决定，渲染层不得改写它，也不得因为「激活被折叠」
  而反向调整顺序。
- **R1.3 全量可见（本次核心）**：重启后 `workspace.tabids` 里的每个 Tab 都在主栏可见
  （水平栏与垂直栏一致），且不带 `unopened-this-launch` 灰化；无手动隐藏时「更多」计数为 0。
  用户看到的应是「关掉前那排 Tab 原样回来」。
- **R1.4 边界**：Go 数据层（`pkg/wcore/workspace.go`、`pkg/waveobj/`）不改；`emain` 恢复路径
  的改动方式与理由见 `design.md` §2.5。
- **R1.5 不回退**：会话内行为保持现状 —— 新建 Tab、切 Tab、关闭 Tab、外部 RPC 新增且未激活的 Tab
  仍按现状进入「更多」；本片只改变「重启恢复」这一时刻的判定。

### R8 点击误判拖拽换位修复（本轮实施，2026-11-14 用户确认）

背景（已核查锚点）：旧拖拽实现方向状态放模块级（`tabbar.tsx:233`）、落点依赖缓存的
`dragStartPositions`（ResizeObserver `:756` / `reinitVersion` `:425` 等调用点只刷一半）、
`handleMouseMove` 对 React state 原地 `splice`（`:594-606`）→ 表现为「只是点/小拖一下，
Tab 却换了位置」且内存顺序与 workspace 落盘不一致。

- R8.1 阈值：位移 < 8px（按 zoomFactor 折算恒定物理距离）或未连续 2 次 mousemove
  越过阈值时，不进入拖拽态、不写任何内联样式；持久化换位阈值保持 50px。
- R8.2 实时测量：拖拽起点与落点比较一律用 mousedown 时的实时 rect 测量，
  不再依赖 `dragStartPositions` 缓存（该状态及 `saveTabsPosition` 一并移除）。
- R8.3 不可变：拖拽期间只在 `tabIds` 副本上操作；只有真实拖拽（≥50px）的 mouseup
  才写回 state 并落盘；亚阈值拖拽仅视觉复位。
- R8.4 方向状态移入 ref（多窗口/多实例不串扰）；判定逻辑抽纯函数
  `frontend/app/tab/tab-drag-model.ts` + 单测（现有拖拽零单测）。

### R9 切换点击响应（本轮实施 A/B；C/D 后续片，2026-11-14 用户确认）

背景：点击 → 激活链路里，主进程动作队列串行（`emain-window.ts:547`，长度≥2 只替换 [1]）
+ 每次点击双重入队（点击路径 + 后端广播 `emain.ts:128` 再入一次）+ 高亮等后端往返。

- R9.1 乐观高亮：点击 Tab 后主栏 active 高亮立即跟随（乐观值优先于 staticTabId，
  仅影响视觉高亮，不影响关闭确认/可见性判定）；后端 `activetabid` 广播确认或
  超时（2s）后清除。水平栏与垂直栏一致。
- R9.2 双入队去重：`electron:updateactivetab` 广播到达时，若该窗口动作队列
  （含正在执行的 [0]）已有同目标的 switchtab，不再重复入队。
- 测量：沿用 `[tabswitch]` 日志（total/backend/webview/setview 分解，`emain-window.ts:652`）；
  C（队列感知最新意图/已加载 Tab 插队）与 D（`reinitWave` 减负，`frontend/wave.ts:158`）
  拿到数据后单独开片。

### R2 填满空间 + 溢出进「更多」（后续片）

- 水平栏（`app:tabbar=top`）：按可用宽度从左到右填，`fit = floor(可用宽 / 每格宽)`；`[0 .. fit-1]`
  上栏，其余进「更多」。
- 垂直栏（`app:tabbar=left`）：按可用高度从上到下填，行高 36px（`h-9`）；`[0 .. fit-1]` 上栏，
  其余进「更多」。
- 窗口锚点固定为 **物理序第 0 个**（不平移）。激活项在窗口外时也进「更多」。
- 极端窄/矮窗口下 `fit` 至少为 1。
- 手动隐藏的 Tab 不参加自动窗口容量计算，始终列在「更多」；其他 Tab 按物理顺序切分，
  手动隐藏与自动溢出不得互相改写状态。
- 水平栏**取消横向滚动**（不再创建 `OverlayScrollbars` 实例）；垂直栏**取消纵向滚动**
  （含拖拽到边缘的自动滚动）。

### R3 单个 Tab 手动隐藏与恢复（跨重启，后续片）

- 每个 Tab 可通过其右键菜单执行「从 Tab 栏隐藏」；该操作只改变显示位置，不关闭 Tab，也不改变
  `workspace.tabids` 顺序或激活项。
- 手动隐藏状态按 Tab ID 持久化，应用重启后仍隐藏；状态在跨 renderer 窗口间同步。
- 「更多」中的手动隐藏行提供「显示在 Tab 栏」恢复动作，不要求先切换该 Tab。沿用现有行为：
  直接点选隐藏行打开该 Tab 时，自动解除其手动隐藏状态。
- 手动隐藏状态只对仍存在的 Tab 有效；关闭/删除 Tab 时清除对应状态，避免遗留无效 ID。
- 自动空间溢出不是手动隐藏：窗口变化可重新计算自动溢出，但不得清除或覆盖用户的手动隐藏选择。

### R4 「更多」触发器（后续片）

- 图标：`makeIconClass("ellipsis", true)`，与 `frontend/app/block/block.tsx` 的
  `inline-tab-block-more-btn` 同款三点。
- 去掉 `fa-layer-group` 图标与垂直栏的「更多」文字。
- 计数徽标 = 折叠进「更多」的 Tab 数；`0` 时不显示数字。
- `count === 0` 时触发器**常驻但降到半透明**（不隐藏），否则菜单里的「新建 Tab / 收起未使用的 Tab」
  入口不可达。
- 触发器在 sidebar 里保持 `WebkitAppRegion: no-drag`。

### R5 折叠项的可发现性（后续片）

- **激活项被折叠**时：触发器加 accent 强调（边框或文字色），`title` 提示「激活的 Tab 在更多里」。
- **未读点被折叠**时：触发器加未读提示（红点或强调色数字）。
- 未读 Tab 与激活 Tab 都**不再**享有「强制留在主栏」的特权（与 R2 的物理序填窗一致）。

### R6 不破坏既有行为

- 两栏的点击切换 / 双击重命名 / 右键菜单 / 拖拽重排 / 关闭同步 全部不变。
- 「更多」面板内的搜索过滤、行点击切 Tab、行 `✕` 关 Tab、`Esc` / 点外侧关闭、「新建 Tab」、
  「收起未使用的 Tab」继续可用；新增的手动恢复动作不得误触发关闭或激活。
- `app:tabbar` 设置项语义不变（只影响用哪个栏，不影响排序模型）。
- 拖拽重排只在主栏窗口内可见 Tab 之间进行；被折叠进「更多」的 Tab 不参与拖拽（与现状一致）。

### R7 可维护性

- 两栏共用同一份纯函数：窗口切分 + 溢出计数 + 可见性判定，落在 `frontend/app/tab/tab-more-model.ts`。
- 不再有两栏各自复制的 `isHidden` / 分组排序逻辑。

## 非目标（Non-goals，明确不做）

- ❌ 不按 recency / 最近使用 / 消息数排序。
- ❌ 不做 pinned 前置 / 分组。
- ❌ 不新增「启动偏好」设置项（如 first / last / byRecency）。
- ❌ 不做自定义「启动钉住顺序」（`tab:pinstart` meta）。
- ❌ 不改 `workspace.tabids` / `workspace.activetabid` 的存储格式或 Go 路径。
- ❌ 不改 Tab 内容区、Block 布局、AI 会话、批注。
- ❌ 首片**不**移除横向/纵向滚动、**不**改「更多」触发器外观、**不**实现手动隐藏持久化（后续片）。
- ❌ 不改变「更多」面板既有搜索、关闭、新建等交互；仅增加手动隐藏 Tab 的恢复动作（R3 片）。
- ❌ 不实现「更多」行 hover 悬浮 Agent Card（属于 `10-26-tab-more-agent-card`，已归档）。

## 验收标准

### 首片补充验收（R8/R9，本轮）

- [ ] 单测红→绿：`tab-drag-model.test.ts`（阈值/连续次数/zoom 折算、方向计算、落点计算含「小位移不换位」回归）；
      `tab-optimistic-active.test.ts`（乐观值 set/clear/超时）；`emain-window.test.ts` 新增双入队去重用例。
- [ ] `npx vitest run frontend/app/tab/ emain/emain-window.test.ts` 全绿；`tsc` 不超基线 47。
- [ ] 手动：快速点击不换位；微拖 5-9px 不跟随不换位；真拖 ≥50px 才换位并落盘；
      点击后高亮立即跟随（不等内容切换）。

### 首片（R1，本次）

- [ ] 关 App 前 5 个 Tab `[A,B,C,D,E]`、激活 `D` → 重开后**主栏 5 个全部可见**、顺序仍是
      `[A,B,C,D,E]`、激活仍是 `D`、无灰化、「更多」计数 0。
- [ ] 垂直栏（`app:tabbar=left`）同上。
- [ ] 重启后点击任意恢复的 Tab 可正常切换；双击重命名、右键、关闭照旧。
- [ ] 重启后立即点「收起未使用的 Tab」→ 非激活 Tab 全部进「更多」（已知语义放宽，见 design §2.5）。
- [ ] 机器判定证据：`npx vitest run emain/emain-window.test.ts frontend/app/tab/` 全绿；
      真机验证台 `scripts/verify/tab-startup-restore/` 退出码 0（播种 5 Tab → 重启 → 断言数量/顺序/
      激活/无灰化/计数）。
- [ ] `npx tsc --noEmit` 错误数不超过既有基线 47。

### 后续片（R2–R5）

- [ ] 关 App 前把 `E` 拖到最前 → 重开后仍是 `[E,A,B,C,D]`。
- [ ] 水平栏 20 个 Tab、窗口宽 1200 → 主栏只显示放得下的前 N 个，其余进「更多」，
      **不出现横向滚动条**。
- [ ] 垂直栏 20 个 Tab、窗口高 700 → 主栏只显示放得下的前 N 个，其余进「更多」，
      **不出现纵向滚动条**。
- [ ] 激活 Tab 在窗口外时，「更多」触发器有 accent 强调且 `title` 提示；点击菜单里的它可切回
      并关闭面板。
- [ ] 触发器图标 = block 同款三点；计数 = 折叠数；计数为 0 时触发器半透明常驻。
- [ ] 手动隐藏 Tab 后主栏不再显示它，`workspace.tabids` 顺序不变；重启后仍在「更多」中。
- [ ] 在「更多」对手动隐藏 Tab 执行恢复后，它回到按 `workspace.tabids` 决定的位置；
      恢复无需激活 Tab。
- [ ] 从「更多」直接打开手动隐藏 Tab 会解除隐藏；关闭 Tab 后持久化隐藏记录被清理。
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
- 「更多」行 hover Agent Card（已有独立归档任务 `10-26-tab-more-agent-card`）。
- 「收起未使用的 Tab」在启动后立即点击会收起全部非激活 Tab —— 若体验不佳，后续片单独收紧目标判定。
