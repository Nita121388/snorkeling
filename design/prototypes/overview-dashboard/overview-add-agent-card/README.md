# Overview 看板 · Tab 下新建 Agent 卡

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/session-overview/overview-board.tsx, frontend/app/session-overview/session-overview.tsx, frontend/app/session-overview/session-overview.scss, frontend/app/workspace/hero-launch-window.tsx, frontend/app/modals/modal.tsx, frontend/app/commontext/commontext-send-button.tsx
> 最后同步：2026-11-20

## 一句话

Overview 看板从纯只读投影变「可写入口」：按 Tab 分组时，每个 Tab 列底部出现 `＋ 新建` 虚线占位卡；点击弹出**居中弹窗**（复用全局 Modal；profile + 模型 + 路径），**路径/连接预填自该 Tab 的 context**，确认后新 agent 块创建进该 Tab，卡片以 enter 动画落入本列。

## 怎么看

浏览器直接打开 `index.html`（无依赖，纯静态）。可交互点：

- 看板视图 + Tab 分组 → 每列底部 `＋ 新建` → 点击弹**居中弹窗** → 选 agent → 创建 → 新卡带 `is-entering` 动画入列、列计数 bump
- 列表视图 → Tab 组末尾 `＋ 在此 Tab 新建 agent` 行，同一弹窗
- 分组切到 状态 / Provider / 标签 → `＋` 消失（派生列，不可加卡）
- 路径段是**可滚动候选列表**（不是下拉/手风琴）：默认选中「随 Tab」那一项，点任意行即切换；第二行只在默认项显示「随 Tab」、远端项显示 `ssh://mac`，普通候选不加副标题
- 页面底部有原型事件日志 + 实现落点说明

## 设计决策（已与用户确认）

1. 新建入口是**居中弹窗**，且 **chrome/样式与 New Agent 弹窗一致**（`hero-launch-window.tsx`：rounded-xl + bg-modalbg/80 + backdrop-blur 容器、chip 行选中态 bg-accent/12 + 左 2px accent 条、h-[28px] 模型输入框、border-t footer）—— 2026-11-20 用户两次反馈改定（先定居中，再定同款样式）。文案复用 `workspace:agentLaunch.*` 词表：新建 Agent / 选择 agent 类型 / 自动（可能按项目偏好）/ 选择一个路径。/ 取消 / 创建。
2. 只在**容器型分组**（Tab）显示 `＋`；status/provider/tags 是派生列，不显示（避免「把卡塞进 working 列 = 让它变 working」的假交互）。
3. 新建的是 **agent 会话卡**（走 `createAgentBlockDefForProfile`），不是笔记卡，不做卡内层级。
4. 路径继承**该 Tab 的 context**，不是当前焦点块的：`inheritWorkspaceContext: false`（`agent-launch.ts:1117` 已有该坑注释）。
5. 路径段是**可滚动候选列表**（与 New Agent 弹窗 path list 同构），不是下拉/手风琴 —— 2026-11-20 用户第三次反馈改定。
6. **文案只留 New Agent 弹窗词表**，不加解释性副标题：`新建 Agent` / `选择 agent 类型` / `选择一个路径。` / 自动（可能按项目偏好）/ 取消 / 创建；Tab 名只在头部出现一次（`text-xxs muted`）—— 2026-11-20 用户第四次反馈，去掉「继承自该 Tab」「当前 Tab」「该 Tab 内块」「手选」等冗余文字。
7. 创建后停留在 Overview，不切 Tab；新卡走既有 `agent-status` 通道出状态 chip。

## 实现落点（原型 → 代码映射）

| 原型元素 | 代码落点 |
|---|---|
| `＋` 占位卡 `.session-overview-board-add` | `overview-board.tsx` BoardColumn 渲染分支末尾（仅 `group === "tab"` 时挂） |
| 居中弹窗容器 | 复用 `<Modal>`（`frontend/app/modals/modal.tsx`）居中 + backdrop；内部 chrome 复制 `hero-launch-window.tsx` 的类串（与 New Agent 弹窗同观感） |
| 弹窗内容 | 新组件（结构参照 `commontext-send-button.tsx` 的 SendTargetPanel 紧凑档） |
| 路径可滚动候选列表 | 数据复用 `commontext-send-target.ts` 的 `collectFolderCandidatesForTab` / `collectAgentLaunchTargetsInTab`；行样式照搬 `widgets.tsx` path list（`max-h-[min(320px,40vh)]` + 左 accent 条 + 图标 + `MiddleEllipsis`） |
| 建块 | `agent-launch.ts:createAgentBlockDefForProfile` + `store/global.ts:createBlock`，context 带 `inheritWorkspaceContext:false` |
| 块落进该 Tab | 复用 `inlinetab-addmenu.tsx` 的 `layoutModel.addBlockToInlineTab` 链路 |
| enter 动画 | `overview-board-motion.ts` 既有 `enter`（180ms），新卡天然走 diff 进 enter 分支 |

## 状态

- [x] ASCII 原型（会话内已确认）
- [x] HTML 原型（本目录）
- [ ] Trellis 任务 + PRD/design/implement
- [ ] 真实组件实现
