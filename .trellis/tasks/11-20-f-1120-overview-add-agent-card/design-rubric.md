# 设计评审 rubric — Overview「＋ 新建 Agent」

> 用途：F-1120-overview-add-agent-card 的 **G4 评审**判据。人逐条签字；
> `queue gate --gate g4 --rubric <本文件>` 会对本文件取 hash 冻结，之后改动即 drift。
> 每条都要能指到**证据**（文件/行 + 测试名 + 原型），不接受"看着不错"。

## 评审对象

| 项 | 内容 |
|---|---|
| 原型（G3） | `design/prototypes/overview-dashboard/overview-add-agent-card/index.html`（● 已落地同步） |
| 实现 | `frontend/app/session-overview/overview-add-agent.ts` / `overview-add-agent-modal.tsx` / `overview-board.tsx` / `session-overview.tsx` / `session-overview.scss` |
| 设计来源（样式真源） | `frontend/app/workspace/hero-launch-window.tsx`（New Agent 弹窗 chrome）、`frontend/app/workspace/widgets.tsx`（path list）、`frontend/app/modals/modal.tsx`（居中壳） |

## 逐条判据

| # | 条目 | 判据（可核验） | 证据位置 | 结论 |
|---|---|---|---|---|
| S1 | 弹窗 chrome 与 New Agent 弹窗一致 | 容器/头部/段标签/chip 行/模型输入框/footer 五处同款；不出现两套视觉语言 | `overview-add-agent-modal.tsx` 注释 + `session-overview.scss` `.session-overview-add-agent-*`；对照 `hero-launch-window.tsx` | ☐ |
| S2 | 文案极简、零自造 | 可见文案全部取自 `workspace:agentLaunch.*` / `heroLaunch.*`；无「继承自该 Tab」「当前 Tab」「该 Tab 内块」「手选」等解释性副标题；Tab 名只在头部出现一次 | `overview-add-agent-modal.tsx` 全文；新增 i18n 仅 3 个 aria 键（中英） | ☐ |
| S3 | 路径段是**可滚动候选列表** | `role=listbox` + `max-height: min(320px,40vh)` + `overflow-y:auto`；默认项（随 Tab）置顶且选中；普通本地行无第二行，远端行第二行是 connection | `session-overview.scss` `.session-overview-add-agent-paths`；`overview-add-agent.ts:collectAddAgentPathRows`；测试 `overview-add-agent-modal.dom.test.tsx`「路径列表」3 条 | ☐ |
| S4 | 选中态表达统一 | chip 与 path 行选中都是 `bg-accent/12` + 左侧 2px accent 条（与 New Agent 弹窗同款） | `session-overview.scss` 两处 `&.is-selected::before` | ☐ |
| S5 | 只用 token 色 / 既有字阶 | 无裸 hex；字号 10/12/13；颜色走 `--accent-color` / `--border-color` / `--secondary-text-color` 等变量 | `session-overview.scss` 新增段；`npx eslint` 0 problems | ☐ |
| S6 | 入口轻量、不挤压卡片 | 虚线占位卡在卡片列表**末尾**；hover / focus-visible 有反馈；不改变既有卡片布局与动效 | `overview-board.tsx:AddAgentButton`；测试 `overview-board-add.test.tsx`「入口在卡片列表里、排在卡片之后」 | ☐ |
| S7 | 派生分组不提供入口 | `status` / `provider` / `project` / `tags` 分组一律不渲染入口 | `overview-add-agent.ts:shouldShowAddAgent`；测试 `overview-board-add.test.tsx` 3 条分组守卫用例 | ☐ |
| S8 | 上下文不串台 | 路径默认取**该 Tab 自身** context（不取焦点块）；建块 `inheritWorkspaceContext:false` 且 `activateTargetTab=false`（不抢焦点、不切 Tab） | `overview-add-agent.ts:buildAddAgentLaunchContext`；`session-overview.tsx:submitAddAgent` / `addAgentData`；测试 `overview-add-agent.test.ts`「建块上下文」3 条 | ☐ |
| S9 | 键盘与关闭路径完整 | 入口可 Tab 聚焦；弹窗 Esc / ✕ / 取消 / backdrop 四路可关；`role=dialog` + `aria-modal` | `modal.tsx` 既有契约；测试 `overview-add-agent-modal.dom.test.tsx` 结构 3 条 | ☐ |
| S10 | 无新依赖、无越界改动 | `package.json` 无新增；未改 `hero-launch-window.tsx` / `widgets.tsx` / 后端 | `git show --stat 82ee59e40` | ☐ |

## 签字

| 门 | 谁 | 命令 |
|---|---|---|
| G1 需求（`prd.md`） | nita | `node E:/primary/projects/loop/bin/loop.mjs queue gate --id F-1120-overview-add-agent-card --gate g1 --by nita --root .` |
| G3 原型 | nita | `... --gate g3 --by nita --ref design/prototypes/overview-dashboard/overview-add-agent-card` |
| G4 评审（本文件） | nita | `... --gate g4 --by nita --rubric .trellis/tasks/11-20-f-1120-overview-add-agent-card/design-rubric.md` |

> G1 签字会对 `prd.md` 取 hash：签完不要再改 PRD 正文，否则包回退 `blocked:g1` 并标 drift。
> G7 验收（真机）不看本文件：需要真机点一遍「看板 → 分组 Tab → ＋ 新建 → 创建 → 卡入列」。
