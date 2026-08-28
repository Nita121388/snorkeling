> 同步状态：● 已落地（真实组件已实现）
> 镜像源：frontend/app/workspace/widgets.tsx, frontend/app/block/inlinetab-addmenu.tsx, frontend/app/store/keymodel.ts, frontend/layout/lib/inlineTabs.ts, frontend/layout/lib/layoutModel.ts
> 最后同步：2026-08-28

# Widget Quick Launch — 键盘快捷启动面板原型

> 对应 Obsidian 方案笔记（如已创建，填路径于此）。

## 设计目标

按 `Cmd/Ctrl+Shift+p` 弹出**居中浮层**，列出全部 supported widget（**无搜索框**——widget 数量少，直接列表）
→ 选一个 widget → 底部出现两个放置按钮 `[New Block]` `[Current Group]` → 点击即启动。

## Terminal / Agent 二级弹窗（New Agent / New Terminal）

Terminal / Agent 不能直通 `createBlock`，需先选目标。流程：

1. 快速面板选 Terminal / Agent → 底部出现 `[New Block]` / `[Current Group]`；
2. 点放置 → 打开**二级弹窗**（与右栏 WidgetsBar 同款的 New Agent / New Terminal 目标选择器）：
   - Agent：profile 选择（codex/claude/gemini/opencode/pi，带 AgentProfileColors 圆点）；
   - path 列表（Home / 当前 Workspace / 远程 ssh，可点选，默认首项高亮）；
   - `[Env]` 本次启动自定义变量（浮窗关闭不丢失，对齐 `agent-launch.ts`）；
   - 底部确认按钮文案随放置变化：New Block → `New Block`，Current Group → `Add to Group`；
3. 确认 → `requestLaunchPopup({mode, anchorEl, sinkNodeId})` → 选目标 → `CreateBlock` → 放置（同通用 widget）。

sink 即快面板选的放置：New Block → `sinkNodeId=null`（创建漏斗进当前 Tab）；Current Group → `sinkNodeId=focusedNodeId`（创建漏斗改道进组，复用 `createBlockInGroupSink`）。

## 文件计划

| 文件 | 改动 |
|------|------|
| **NEW** `widget-quick-launch.tsx` | 居中浮层组件 + widget 列表 + 两按钮放置 + `openWidgetQuickLaunch()` 导出（~80–100 行，无搜索框） |
| **EDIT** `keymodel.ts` | 加 `Cmd:Shift:p` 绑定 + 注册到 webview keys（~5 行） |
| **EDIT** `widgets.tsx` | 右键菜单加 "Quick Launch"（可选，~3 行） |

复用、不改：`addBlockToInlineTab` / `requestLaunchPopup` / `pickGroupAddableWidgets` / 布局模型 / Agent·Terminal 浮窗。无新依赖。

## 原型交互说明

- **触发**：按 `⌘⇧P` / `Ctrl+Shift+P` 或点页面上方按钮。
- **Tab 布局**：页面中展示当前 Tab 的三个 pane（1 单 Block + 1 组 + 1 单 Block），点击 pane 切换 focus。
- **放置结果**：New Block → 在 focused 后追加兄弟 pane；Current Group → focused 是组则追加 Tab，是单 Block 则自动升级为组。
- **键盘**：↑↓ 移动高亮，Enter 选中 widget，Esc 关闭面板。
- **action 型 widget**（Text / commontext）：点击直接触发 `openCommonTextSearch()`，无放置选项，不产 block。
