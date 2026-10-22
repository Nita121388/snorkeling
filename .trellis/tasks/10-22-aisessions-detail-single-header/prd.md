# 会话详情块单 Header 化：消除 WaveTerm 块框头与详情面板头的双 Header

## Goal

会话详情块上下叠了两条横条，两条都带下边框，视觉上像两个 Header。目标是让详情块只保留一条 Header，并且保留 WaveTerm 原生的拖拽手柄、右键菜单、放大、关闭等块级交互。

本任务当前只做方案设计与原型，不写实现代码。实现等方案拍板后再启动。

## 现场证据（2026-10-22）

- `frontend/app/block/block.scss:192` — WaveTerm 块框头 `.block-frame-default-header`：`min-height/max-height: var(--header-height)`（30px），`border-bottom: 1px solid var(--border-color)`，`font: var(--header-font)`（700 11px Inter）。
- `frontend/app/block/blockframe-header.tsx:636` — 块框头左区只渲染 `viewIconElem`（aisessions 是 `comments` 图标）；`metaFrameText` 被 `hideViewName` 挡住。
- `frontend/app/view/aisessions/aisessions.tsx:106-108` — `viewName = ""`、`hideViewName = true`、`noPadding = true`。结论：aisessions 视图的块框头**没有任何文字**，中间区整块是空的。
- `frontend/app/block/blockframe-header.tsx:203-215` — 块框头中区由 `viewModel.viewText` 驱动，aisessions 没有提供 `viewText`，所以中区恒空。
- `frontend/app/view/aisessions/session-detail.tsx:1163` — 详情面板头：`flex h-[46px] shrink-0 items-center gap-2 border-b border-border px-3`，含展开列表按钮、会话标题（双击改名）、来源 chip、模型 chip、搜索/星标/更多三个图标按钮。
- 两条横条各画一条下边框，垂直相邻 → 观感是「两个 Header」。
- `frontend/app/view/aisessions/aisessions.tsx:1120` — `showsDetailPane = sessionListCollapsed || blockSessionId !== "" || blockNewChat`。所以「详情块」和「列表收起状态」两种情况都会叠上这条面板头。

## Requirements

### R1 详情块只出现一条 Header（P0）

- 详情块（`blockSessionId !== ""` 或 `blockNewChat === true`）顶部只保留一条 Header。
- 这条 Header 必须同时承担：块身份（图标）、会话身份（标题）、会话元信息（来源、模型）、会话级操作（搜索、标记、会话菜单）、块级操作（刷新、放大、合并、关闭、块右键菜单）。
- 会话标题仍是主视觉元素，字号不小于 13px，不低于次级信息的对比度。

### R2 WaveTerm 原生块交互一个都不能丢（P0）

- 块框头的拖拽手柄（`data-role="block-header"` 上的 `dragHandleRef`）必须保留。
- 块框头右键菜单（放大 / 关闭 / 移到新 Tab / 复制块 / 设置项）必须保留。
- 块级按钮（放大、合并到上一个块、关闭）必须保留。
- 会话级操作（改名、编辑 note、删除、恢复、打开会话文件、跳到项目目录、刷新历史、搜索、标记星标）必须保留且可达。

### R3 列表块行为不变（P0）

- 纯列表块（没有绑定会话、列表未收起）不渲染详情面板，块框头保持现状（图标 + 刷新按钮）。
- 列表块与详情块并排时，右侧详情面板的头部保持现状，不与块框头视觉冲突。
- 列表收起/展开的交互不回归。

### R4 视觉层级明确（P1）

- 一级信息：会话标题。二级信息：来源、模型 chip。三级：块级按钮。
- 块框头与消息区之间只保留一条分割线，不再出现两条相邻的下边框。
- 明暗主题下都成立，浅色主题不出现文字对比度不足。

### R5 不引入行为回归（P0）

- 会话改名（双击标题）仍然可用，Enter 提交、Esc 取消、失焦提交。
- `endIconButtons` 现有的自动刷新按钮（带 "Auto" 徽标、自适应宽度）不受影响。
- 搜索浮层、大纲轨、聊天输入框、流式跟随、虚拟化时间线全部不受影响。
- 会话详情块的其他视图（`view/aisessions/agent.tsx` 等）不受影响。

### R6 方案可回退（P1）

- 头部合并必须能通过一个开关退回现状（双 Header），不靠 git revert 才能回退。
- 开关默认开启新方案，但保留一条路径立刻关掉。

## 约束

- 不改 `frontend/app/block/blockframe-header.tsx` 的块级交互逻辑，只用已有的 `viewText` / `endIconButtons` / `noHeader` 扩展点。
- 不新造一套块级按钮组件；块级按钮继续由 `HeaderEndIcons` 渲染。
- 改动集中在 `frontend/app/view/aisessions/` 与 `frontend/app/block/block.scss`（新增一个标题样式变体）。
- 清单块与详情块共用 `AiSessionsViewModel`，所以「是否合并」必须由状态驱动，不能按视图类型写死。

## Acceptance Criteria

- [ ] 详情块顶部只有一条 Header，截图确认无两条相邻下边框
- [ ] 会话标题、来源 chip、模型 chip 全部在唯一那条 Header 上可见
- [ ] 块框头拖拽可用、右键菜单可用、放大/合并/关闭可用
- [ ] 搜索、星标、会话菜单（改名/note/删除/恢复等）全部可达
- [ ] 双击标题改名可用，Enter 提交、Esc 取消
- [ ] 纯列表块外观与改动前一致
- [ ] 列表展开态的左右并排布局与改动前一致
- [ ] 明暗主题各验一遍
- [ ] 开关关掉后能回到双 Header 现状
- [ ] `pnpm vitest` 相关用例全绿，`tsc` 与 `eslint` 对改动文件无报错
- [ ] `node docs/sync-audit/audit-sync.mjs` 无「镜像缺失」告警

## 待拍板

> **2026-10-22 决策记录：先记录在案，暂不拍板、暂不实现。** 本任务保持 `status=planning`，未执行 `task.py start`，`frontend/` 零改动。后续直接回到本节选方案即可。

- 方案 A（合并进块框头）、方案 B（隐藏块框头）、方案 C（双层弱化）三选一。
- 交互原型：`design/prototypes/session-detail-block-header/index.html`。
- 方案对比与推荐：见答案页 `docs/answers/session-detail-block-双header美化方案-*.html`。

## Notes

- `prd.md` 只写需求、约束、验收标准。技术设计见 `design.md`，执行计划见 `implement.md`。
- 本任务不进入实现阶段，直到方案拍板并执行 `task.py start`。
