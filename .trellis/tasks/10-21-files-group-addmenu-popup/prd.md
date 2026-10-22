# PRD — Tabs 组「+」菜单的 Files 项支持二级路径中枢弹窗

## 背景

Tabs 组（inline-tab group）右上角的「+」按钮由 `InlineTabGroupAddButton`
（`frontend/app/block/inlinetab-addmenu.tsx`）渲染，菜单项来自右侧 WidgetsBar 同一份
`fullConfig.widgets` 注册表（`pickGroupAddableWidgets`）。

当前两类菜单项的行为**不一致**：

| 菜单项 | 点击 / 悬浮 |
|---|---|
| Terminal | 二级浮窗（目标选择器），创建结果回填进本组 |
| Agent | 二级浮窗（目标选择器），创建结果回填进本组 |
| **Files** | **直接创建 preview block**（`buildFilesBlockDef` 继承活跃终端 cwd/connection），没有二级浮窗 |

而右侧 WidgetsBar 的 Files 是**路径中枢浮窗**（`NewFilesFloatingWindow`：Pinned /
Frequent / Recent 分区 + 搜索 + Home），这一能力（见任务 `10-12-files-widget-path-hub`）
在组「+」菜单里完全用不到——用户在组里想打开一个"最近用过的路径"只能绕回右侧栏。

## Goal

让组「+」菜单里的 **Files 项与 Terminal / Agent 对齐**：点击（或悬浮）打开**同一个**
路径中枢二级浮窗，内容与右侧 WidgetsBar 的 Files **完全一致**，选中路径后创建的
preview block **落回发起请求的那个组**。

## Requirements

### R1 — Files 变为「二级浮窗入口」

- 组「+」菜单中的 Files 项不再走 `handleDirectCreate`。
- 点击立即开二级浮窗；悬浮满 `LaunchHoverOpenDelayMs`（与 Terminal/Agent 同一延迟）后开二级。
- 菜单项右侧显示与 Terminal/Agent 相同的 chevron 提示（`inline-tab-block-addmenu-hint`）。

### R2 — 浮窗内容与右侧 Files 完全一致（复用同一组件）

- 必须复用 `frontend/app/view/preview/preview-new-files.tsx` 的 `NewFilesFloatingWindow`，
  **不得**复制一份简化版面板。
- 一致的能力：Pinned / Frequent / Recent 分区、搜索过滤、键盘（↑↓ / Enter / Esc）、
  行内 Pin / Unpin、Copy path、Remove、footer Home。
- 数据源一致：`settings["preview:pinned-directories"]` 与 `pathUsageAtom`（`preview:path-usage`）。
- 视觉一致：同一套 class / 分区标题 / 空态提示。

### R3 — 创建结果回填发起组（sink 语义）

- 选中路径（或 Home）后创建的 preview block（`{view: "preview", file, connection}`）
  必须追加进发起「+」菜单的 inline-tab 组并激活。
- 组在创建时已被关闭（`addBlockToInlineTab` 失败）→ 回退为普通入 tab 插入，
  不丢失用户已选好的路径（与 `createBlockInGroupSink` 现有约定一致）。
- **右侧 WidgetsBar 自身打开该浮窗时行为完全不变**（无 sink → 走 `env.createBlock` 原路径）。

### R4 — 一级/二级浮窗协作

- 二级浮窗打开期间一级菜单**不收起**。
- 二级关闭后，若指针已不在图标/一级菜单上，一级延时收起（沿用现有
  `scheduleMenuClose` 机制）。
- `Esc` 先关二级；二级关闭后再 `Esc` 才关一级。
- 二级需通过 `onOpenChange` 把 open 状态回传一级（`launch-popup-bus` 已有该约定）。

> **连带修复（R4 的前提）**：`widgets.tsx` 里三个二级浮窗的 close 函数在关闭时会回传
> `onOpenChange(false)`，而「打开另一个二级浮窗」也要先 close 当前浮窗 → 会被误报成
> 「二级已关」，导致一级菜单提前收起 + Esc 一次关两层。该缺陷今天就存在于
> Terminal / Agent 之间，Files 接入后会继承。本任务给三个 close 函数增 `notifyBus` 参数
> （默认 true），「换浮窗」的路径传 false（详见 design.md §2.3.1）。

### R5 — 终端上下文继承

- 非 sink（右侧栏）场景语义不变。
- 组场景下若组内存在活跃终端 block，其 `connection` 作为浮窗选择项的兜底；
  用户显式选中某路径时以该行自带的 `connection` 为准。
- 无活跃终端时不影响功能（只是没有 cwd 提示）。

### R6 — 不回归

- 右侧 WidgetsBar：Files hover 打开、点击直接建块、行内按钮、Esc 关闭均不变。
- Quick Launch 弹窗、Ctrl+Hover 放置上下文、`pickGroupAddableWidgets` 过滤规则不变。
- 其它组「+」菜单项（Terminal / Agent / Note / 普通 widget）行为不变。

## 非目标（Out of Scope）

- 不改路径中枢的数据模型、分区算法、pin 配置键（属 `10-12-files-widget-path-hub`）。
- 不改右键菜单 / 目录树里的「Open in New Block」等其它入口。
- 不新增后端 RPC、不改 `settingsconfig.go`。

## 验收标准

功能（手测，CDP 或真机）：

1. 组内多 tab（blockIds.length > 1）时「+」→ hover Files 约 500ms → 二级浮窗出现在菜单项右侧，
   分区与右侧 WidgetsBar 打开的完全一致。
2. 点击 Files → 立即开二级；一级菜单保持开启。
3. 在二级里选一个最近路径 → preview block 进入**当前组**并激活；组已关闭时落入当前 tab。
4. 二级里 Pin / Unpin / Copy / Remove / Home 与右侧栏表现一致（同一份状态，双向同步）。
5. 鼠标从二级移出到空白处 → 二级关、一级在 220ms 后关；按 Esc 逐层关闭。
6. 右侧 WidgetsBar Files hover → 浮窗正常，选路径 → 普通建块（不进入任何组）。

回归：

7. `npx vitest run frontend/app/block frontend/app/workspace frontend/app/view/preview` 全绿。
8. `npx tsc --noEmit` 无新增错误（由子代理后台跑，避免主会话阻塞）。

## 依赖

- `10-12-files-widget-path-hub`（父任务）：提供路径中枢面板、`path-panel-model`、
  `path-usage-store`。本任务只做入口接线，不改其内部实现。
