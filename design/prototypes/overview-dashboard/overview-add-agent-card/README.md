# Overview 看板 · Tab 下新建 Agent 卡

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/session-overview/overview-board.tsx, frontend/app/session-overview/session-overview.tsx, frontend/app/session-overview/session-overview.scss, frontend/app/modals/modal.tsx, frontend/app/commontext/commontext-send-button.tsx
> 最后同步：2026-11-20

## 一句话

Overview 看板从纯只读投影变「可写入口」：按 Tab 分组时，每个 Tab 列底部出现 `＋ 新建` 虚线占位卡；点击弹出**居中弹窗**（复用全局 Modal；profile + 模型 + 路径），**路径/连接预填自该 Tab 的 context**，确认后新 agent 块创建进该 Tab，卡片以 enter 动画落入本列。

## 怎么看

浏览器直接打开 `index.html`（无依赖，纯静态）。可交互点：

- 看板视图 + Tab 分组 → 每列底部 `＋ 新建` → 点击弹**居中弹窗** → 选 agent → 创建 → 新卡带 `is-entering` 动画入列、列计数 bump
- 列表视图 → Tab 组末尾 `＋ 在此 Tab 新建 agent` 行，同一弹窗
- 分组切到 状态 / Provider / 标签 → `＋` 消失（派生列，不可加卡）
- 选择器内路径行显示该 Tab 的 cwd（远端 Tab 显示连接徽标），点 🔒 展开目录候选（复用 commontext 的 folder 候选交互）
- 页面底部有原型事件日志 + 实现落点说明

## 设计决策（已与用户确认）

1. 新建入口是**居中弹窗**（全局 `Modal`），不是锚定在被点 `＋` 上的 popover —— 2026-11-20 用户反馈改定。
2. 只在**容器型分组**（Tab）显示 `＋`；status/provider/tags 是派生列，不显示（避免「把卡塞进 working 列 = 让它变 working」的假交互）。
3. 新建的是 **agent 会话卡**（走 `createAgentBlockDefForProfile`），不是笔记卡，不做卡内层级。
4. 路径继承**该 Tab 的 context**，不是当前焦点块的：`inheritWorkspaceContext: false`（`agent-launch.ts:1117` 已有该坑注释）。
5. 创建后停留在 Overview，不切 Tab；新卡走既有 `agent-status` 通道出状态 chip。

## 实现落点（原型 → 代码映射）

| 原型元素 | 代码落点 |
|---|---|
| `＋` 占位卡 `.session-overview-board-add` | `overview-board.tsx` BoardColumn 渲染分支末尾（仅 `group === "tab"` 时挂） |
| 居中弹窗容器 | 直接复用 `<Modal>`（`frontend/app/modals/modal.tsx`），title + subtitle 写目标 Tab，footer 走 onCancel/onOk |
| 弹窗内容 | 新组件（结构参照 `commontext-send-button.tsx` 的 SendTargetPanel 紧凑档） |
| 路径候选随 Tab | 复用 `commontext-send-target.ts` 的 `collectFolderCandidatesForTab` / `collectAgentLaunchTargetsInTab` |
| 建块 | `agent-launch.ts:createAgentBlockDefForProfile` + `store/global.ts:createBlock`，context 带 `inheritWorkspaceContext:false` |
| 块落进该 Tab | 复用 `inlinetab-addmenu.tsx` 的 `layoutModel.addBlockToInlineTab` 链路 |
| enter 动画 | `overview-board-motion.ts` 既有 `enter`（180ms），新卡天然走 diff 进 enter 分支 |

## 状态

- [x] ASCII 原型（会话内已确认）
- [x] HTML 原型（本目录）
- [ ] Trellis 任务 + PRD/design/implement
- [ ] 真实组件实现
