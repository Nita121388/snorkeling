# PRD — 路径选择浮窗滚动契约统一

## 背景

WidgetsBar 右侧竖条有三个「路径选择」浮窗：New Terminal、New Agent、Files。
前两个共用同一份「路径列表」渲染（`frontend/app/workspace/widgets.tsx`），
路径来源是**当前 tab 里的每个 terminal / agent / preview(Files) 块各贡献一条**
（`getCurrentTabAgentLaunchTargets()` / `getCurrentTabTerminalLaunchTargets()`，
`frontend/app/workspace/agent-launch.ts:848/863`）。

现状问题：

1. **路径列表无限增高**：列表容器 `<div className="px-1 pb-1">` 没有任何高度约束，
   浮窗根节点是 `max-w-[520px] overflow-visible`，所以 tab 里块越多，浮窗越长。
2. **整个弹窗在滚**：floating-ui `size` middleware 给根节点写了内联样式
   `maxHeight = availableHeight` + `overflowY = "auto"`。`availableHeight` ≈ 整个视口高，
   于是「先长到视口高，长不动了才开始滚」——滚的是**整个浮窗**
   （New Agent 标题、profile 芯片、vendor 芯片、底部按钮一起滚走）。

第三个浮窗 Files（`frontend/app/view/preview/preview-new-files.tsx`）**已经是正确范式**：
根节点 `max-h-[500px] overflow-hidden flex flex-col`，内层 `flex-1 overflow-y-auto min-h-0`，
只有列表滚、浮窗不滚。它是本次改造的参照实现。

## Goal

统一三个路径选择浮窗的滚动契约：

- **路径列表设最大高度并自行滚动**；
- **浮窗本身不滚**：标题 / 芯片 / footer 固定不动；
- 三者的视口自适应与贴边翻转行为一致。

## Requirements

### R1 — Terminal / Agent 路径列表限高内滚

- `AgentTargetFloatingWindow`（`widgets.tsx`）与 `TerminalTargetFloatingWindow`（同文件）
  的路径列表容器必须同时具备：最大高度上限 + 自身滚动容器。
- 列表上限取 `max-h-[min(320px,40vh)]`（约 8 行；一行 ≈ 38px）。
- 滚动容器必须 `overscroll-contain`：列表滚到底后滚轮**不外溢**到浮窗或页面。

### R2 — 浮窗本身不参与滚动

- 两个浮窗的根节点从 `overflow-visible` 改为 `flex flex-col overflow-hidden`。
  **这是「整个弹窗滚动」的直接根因修复**：改成 flex 列 + 路径列表 `flex-1 min-h-0` 后，
  溢出量被列表吸收（列表变矮并内部滚动），根节点不再溢出。
- `size` middleware 的 `maxHeight` 夹上限：`min(availableHeight, 640px)`，
  并保留既有的 120px 退化地板。
- `size` middleware 的 `apply` **保留**内联 `overflowY = "auto"` 作为退化兜底：
  根节点已是 flex 列，正常情况下它永远不会真的溢出（所以看起来「不滚」）；
  只有视口矮到 chrome 段（header + 芯片 + footer ≈ 200px）都放不下时根才会溢出，
  此时整窗可滚保证 footer 按钮仍可达。
- 标题 / agent-type 芯片 / vendor 芯片 / Pi「启动方式」段 / footer 段加 `shrink-0`，
  保证被压缩时优先压缩路径列表而不是 chrome。

### R3 — New Files 与前两者对齐

- 根节点上限从固定 `max-h-[500px]` 改为 `max-h-[min(500px,calc(100vh-32px))]`（视口相关）。
- `useFloating` 的 middleware 补 `flip()` + `shift({ padding: 12, limiter: limitShift() })`
  （当前只有 `offset(8)`），贴边时能翻转/平移，与 Terminal/Agent 一致。
- **不得**给 Files 引入 floating-ui 的 `size` middleware：它的 `apply` 写内联
  `overflowY:auto`，会把整个浮窗重新变成滚动容器。视口上限用纯 CSS `calc()` 即可。

### R4 — 视觉与行为零回退

- 条目数少（≤ 8）时，浮窗外观与改动前完全一致（列表不滚动、无滚动条）。
- 空态 `No paths found` 保留在滚动容器内，容器高度自适应，不留空滚动条。
- 远端路径（双行 `target.label`）渲染不变。
- 居中模式（Quick Launch 触发，`centered=true`）的 `translate(-50%,-50%)` 定位不变。
- 右侧 WidgetsBar 的 Terminal / Agent / Files 三个 widget 的主行为不变。

### R5 — 边界不回归

- 视口极小（`availableHeight` 逼近 120px 地板）时，浮窗退化为可滚动整窗，
  不出现内容被裁掉且无法访问的情况。
- 组「＋」菜单打开的 Terminal / Agent 二级浮窗（复用同一组件）自动受益。

## Non-Goals（本期不做）

- ❌ 路径列表的 ↑/↓ 键盘导航 + `scrollIntoView`（Files 浮窗已有此能力，
  Terminal/Agent 只有 Tab + Enter/Space）→ 单开一次改动
- ❌ Files 面板分区标题（Pinned / Frequent / Recent）sticky
- ❌ 组「＋」菜单的 Files 项改走路径中枢弹窗 → 属任务
  `10-21-files-group-addmenu-popup`，本任务只保证 Files 浮窗组件本身是后续可复用的正确形态
- ❌ 任何后端 RPC / 数据模型 / 配置键改动

## Acceptance Criteria

### 功能（CDP 或真机手测）

- [ ] tab 内 ≥ 15 个块 → 打开 New Terminal：浮窗高度**恒定 ≤ 640px**，路径列表出现滚动条，
      标题与底部按钮**位置不动**
- [ ] 同上 → 打开 New Agent：同样表现，且 profile 芯片 / vendor 芯片区固定不动
- [ ] 列表内滚到底继续滚 → 浮窗与页面**不跟着动**（`overscroll-contain` 生效）
- [ ] tab 内 ≤ 5 个块 → 打开 New Terminal / New Agent：外观与改动前一致，无滚动条
- [ ] 0 个可选路径 → 显示 `No paths found`，无多余空白
- [ ] 视口极矮（availableHeight < chrome 段高度）→ 整窗可滚，footer 按钮仍可点到
- [ ] 打开 New Files：面板高度 ≤ `min(500px, 100vh-32px)`；锚点贴近屏幕下缘时
      面板向上翻转而不是出屏

### 回归

- [ ] `npx vitest run frontend/app/workspace frontend/app/view/preview frontend/app/block` 全绿
- [ ] `npx tsc --noEmit` 无新增错误
- [ ] 右侧 WidgetsBar 三个 widget 的点击/悬浮主行为不变
- [ ] 组「＋」菜单的 Terminal / Agent 二级浮窗行为不变

## Notes

- 参照实现：`frontend/app/view/preview/preview-new-files.tsx:142`（根节点）与 `:167`（滚动容器）。
- 设计系统依据：`docs/design-system.md:194`
  —— *"Dialog layout is header, scrollable content, and footer.
  Footer actions do not move when content overflows."*
- 本任务为纯布局改动，不含逻辑变更。
