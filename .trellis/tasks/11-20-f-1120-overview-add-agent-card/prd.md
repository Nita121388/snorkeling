# Overview 看板 Tab 下新建 Agent 卡

## Goal

Overview 看板（看板视图，按 Tab 分组）与列表视图的每个 Tab 组底部提供「＋ 新建」入口，
点击弹出**居中弹窗**（chrome/样式与 New Agent 弹窗一致），可选手动 agent、覆盖模型、从该 Tab 的路径候选中选择工作目录；
确认后在该 Tab 内创建一个新的 agent 块（不切换焦点、不抢当前 Tab）。

## 做什么

1. **看板入口**：`overview-board.tsx` 在 `group === "tab"` 时，每个 Tab 列卡片列表末尾渲染虚线占位按钮
   `.session-overview-board-add`（文案「新建」，复用 `workspace:agentLaunch.newAction`）。
2. **列表入口**：`session-overview.tsx` 的 `TabGroupSection` 卡片列表末尾渲染 `＋ 在此 Tab 新建 agent` 行
   （`.session-overview-tab-add`）。
3. **分组守卫**：仅容器型分组（`tab`）显示入口；`status` / `provider` / `project` / `tags` 是派生列，不显示
   （避免「把卡片塞进 working 列 = 让它变 working」的假交互）。纯函数 `shouldShowAddAgent(group)` 承载该规则。
4. **新建弹窗** `overview-add-agent-modal.tsx`：
   - 容器：全局 `<Modal>`（`frontend/app/modals/modal.tsx`）→ 居中 + backdrop；
   - chrome 复刻 New Agent 弹窗（`hero-launch-window.tsx`）：标题行 + 右侧 ✕、段标签 `text-xxs muted`、
     agent **chip 行**（选中 `bg-accent/12` + 左 2px accent 条）、`h-[28px]` 模型输入框、`border-t` footer；
   - 内容三段：选择 agent 类型（profile chips + 模型输入框）、选择一个路径。（**可滚动候选列表**）、footer 取消/创建；
   - 文案全部复用 `workspace:agentLaunch.*` 词表，Tab 名只在头部出现一次。
5. **路径候选随 Tab**：候选来自该 Tab（`collectAgentLaunchTargetsInTab`），经 `collectFolderCandidatesForTab`
   去重排序；默认选中「随 Tab」项；远端 Tab 每行第二行显示 connection（如 `ssh://mac`）。
6. **建块**：`createAgentBlockDefForProfile(profile, settings, context)`，其中
   `context = { connection, cwd, inheritWorkspaceContext: false }`（不继承当前焦点块上下文），
   再用 `ObjectService.CreateBlockInTab(tabId, blockDef, DefaultRuntimeOpts, false, false)` 建到目标 Tab，
   **activateTargetTab=false**（不抢焦点）；模型输入框有值时才作为 `modelOverride` 传入。
7. **i18n**：仅新增 aria-label 等辅助串到 `session-overview` 命名空间（中英各一份）；可见文案一律复用既有 key。

## 不做什么

- 不做自定义笔记卡 / 卡内层级子卡 / 拖拽建卡。
- 不沿用 New Agent 弹窗的「启动方式（TUI/GUI）」「环境变量」「cc-switch 供应商选择」三块（本入口只做最小创建）。
- 不在 `status` / `provider` / `project` / `tags` 分组下提供新建入口。
- 不改 `hero-launch-window.tsx` / `widgets.tsx`（New Agent 弹窗本体零改动）。
- 不改后端（无 Go / RPC 变更；`CreateBlockInTab` 既有能力）。
- 空 Tab 在看板列里本来就不渲染（既有行为，不在本包改动）。

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-add-agent.test.ts` → `passed`
- [ ] `npx vitest run frontend/app/session-overview/overview-add-agent-modal.dom.test.tsx` → `passed`
- [ ] `npx vitest run frontend/app/session-overview/overview-board-add.test.tsx` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "overview-add-agent"` → `0`
- [ ] `npx eslint frontend/app/session-overview/overview-add-agent.ts frontend/app/session-overview/overview-add-agent-modal.tsx frontend/app/session-overview/overview-board.tsx frontend/app/session-overview/session-overview.tsx` → `0`

> 注：仓库 tsc 基线非零（其他在途包 58 条），`session-overview/` 整目录还有 3 个老夹具因
> `propRows` 新字段未补而红（11-17-overview-card-props 在途）。本包只对**自己新增/改动的
> 文件**取 0 错误基线，不替别人的包背债。

判定细节（由上述测试锁住）：

- `shouldShowAddAgent("tab") === true`；`status/provider/project/tags` 均为 `false`。
- 看板 `group="tab"` 时每列渲染 1 个 `.session-overview-board-add`；`group="status"` 时 0 个。
- 弹窗：标题 = 新建 Agent；Tab 名在头部出现一次；段标签 exact 为 `选择 agent 类型` / `选择一个路径。`；
  默认预选第一个探测到的 profile（与 New Agent 弹窗一致），「创建」立即可用；点其它 chip 即切换选中。
- 路径列表：`role=listbox`，行数 = 候选数，默认选中「随 Tab」项；普通本地候选无第二行，远端项有 connection 行。
- 创建时回调携带：`tabId`（列/组所属 Tab）、`profileName`、`path`（选中项，默认 Tab cwd）、
  `modelOverride`（仅输入框非空时）、`connection`（远端 Tab 保留）。
- 创建后请求体断言：`activateTargetTab === false`、`context.inheritWorkspaceContext === false`。

## 备注

- 原型（G3 产物）：`design/prototypes/overview-dashboard/overview-add-agent-card/`（v5，HTML + jsdom 冒烟 21 条）。
- 设计评审记录：2026-11-20 五轮反馈收敛（锚定弹层 → 居中 → New Agent 同款 chrome → 滚动路径列表 → 去冗余文案）。
- 分类：命中 `*.scss` → `redesign`（G1/G3/G4 人签 + G2/G5 机器）。
