# Overview 优化 1-4：点击语义 / 分组视图 / 标签美化 / 甘特重修

## Goal

把 Overview 看板从「点卡片就跳会话详情」改成「点卡片开整卡（AgentCardModal）、卡内再开详情」，
并把看板的信息承载补齐：分组新增**目录 / 标签**两种口径、卡片补上**会话标签**与**迷你时间线**、
甘特图从「会话寿命 + 猜尾巴」换成**真实分段 + 小圆角 + 完成点**。

来源：nita 2026-11-06 Overview 优化 6 点中的第 1-4 点（第 5 点 agent 状态/自定义工作流状态暂不做）。

## 背景（现状实测）

| 事实 | 位置 |
|---|---|
| 卡片点击直接开会话详情 | `session-overview.tsx:2518` `onOpenSession` → `openSessionDetail` |
| 整卡弹窗已存在（block 头 hover 卡「放大」按钮） | `modals/agentcardmodal.tsx` + `modals/modalregistry.tsx:40` |
| 整卡内「Add property」不可用（bug） | `agent-hover-card.tsx:308` `onOpenCardDialog={embedded ? undefined : openCardDialog}` |
| 分组只有 status / tab / provider | `overview-board-model.ts:385` `OverviewBoardGroups` |
| 卡片只有 provider / project 两个灰 chip，无 tags | `overview-board.tsx:143` `chips` |
| 卡片无任何时间线 | 无 |
| 甘特条圆角 9px（胶囊） | `session-overview.scss:1873` |
| 甘特尾巴宽度是猜的 | `overview-timeline-model.ts:111-115` `tailMsFor` |
| `completedAt` 有值但没进时间线模型 | `agent-status-types.ts:47` |

## Requirements

### R1 卡片点击语义（包 1）

- 看板卡片点击 = 打开 **AgentCardModal**（`modalsModel.pushModal("AgentCardModal", { blockId, blockData })`），不再直接开会话详情。
- AgentCardModal 内新增「打开会话详情」入口 → `pushModal("AISessionDetailModal", { sessionId })`（叠加在整卡之上，可逐层退）。
- 非 agent 块（普通 term / 其它 view）没有整卡可开：点击保持现有行为（选中 + 跳转 block）。
- 顺手清掉 `agent-hover-card.tsx:308` 的死三元（`onOpenCardDialog={embedded ? undefined : openCardDialog}`）：
  `SessionNoteSection` 只在 `variant !== "hover"` 分支用它，而这里恒传 `variant="hover"`，故永不被消费。
  **不是功能 bug**（「Add property」由 `canEditProperties` 控制），只做清死代码。- 卡片键盘可达性不变（`div role=button` + Enter/Space）。

### R2 分组：目录视图 / 标签视图（包 2）

- `OverviewBoardGroups` 新增 `project`（目录）与 `tags`（标签）两个口径；`overviewBoardGroupAtom` 持久化自动放行。
- 目录视图：列 = 会话 `projectPath` 的 basename；列序 = 卡片数降序 → 标题升序；无项目归「无项目」列且**永远排最后**（照抄 provider 的 fallback 规则）。
- 标签视图：列 = 该 tab 内所有会话 tags 的**并集**（去重、按首次出现顺序或字母序，需固定一种）；无标签会话归「无标签」列且排最后；**一张卡可出现在多列**（多标签），需在图例/列头写明「按标签，卡可重复」。
- 两个新口径都不补空列（与 tab / provider 一致）。

### R3 卡片标签美化 + 迷你时间线（包 3）

- 卡片 meta 行显示会话 `tags`（`summary.tags`），样式复用 `property-chip` 令牌（与 aisessions 属性面板同源），最多显示 3 个 + `+n` 溢出计数。
- 卡片底部加**迷你时间线**：一段横向条，按 `working / idle / done` 分段着色，宽度按真实时长比例（数据源同 R4 的 segments 模型；无历史时退化成「单段当前态」）。
- 卡片高度不因 tags 数量跳动（溢出截断，不换行堆高）。

### R4 甘特重修（包 4）

- 圆角：段间 `3px`、整条 `4px`，段之间留 1px 缝，取消 9px 胶囊。
- 条语义：从「`createdAt → updatedAt/now` 会话寿命 + 猜尾巴」换成 **`buildTimelineSegments`**（真实状态分段；无历史时第一段为 `unknown`、末段为当前态）。
- 完成点：`completedAt` 在 bar 上画竖刻度 + 悬停显示 `HH:MM 完成`。
- idle 段用中性灰实心段（不再并入斜纹「状态未知」），宽度 = `now − completedAt`。
- 图例补「运行 / 空闲 / 完成 / 状态未知」四项。
- **数据来源约束**：状态历史必须在 `pkg/agentstatus` 的 `report()` 内部记录（那里拿得到 prev/next）；不得在前端挂 `agentstatus` 事件自行累积 —— `sameStatus()` 把 `UpdatedAt/ActiveSince` 排除在比较外（`agentstatus.go:539`），idle→working 只改 `ActiveSince` 时 `willEmit=false`，前端会漏段。

## 不做什么

- 不做第 5 点：自定义工作流状态（`props["workflow_state"]`）、维护 agent CLI（`wsh agentstatus list` / `wsh sessions list`）。
- 不改 `AgentDisplayState` 枚举、不改 `normalizeOverviewBoardStatus` 的 5 列语义、不动 ack/seen 判定。
- 不改列表视图 / 时间线视图的行点击语义（时间线点击仍开会话详情，与列表一致）。
- 不重做 AgentCardModal 的视觉（那是 `11-02-modal-single-shell-refactor`）。
- 不做看板卡片动作（关闭 / 删除，那是 `11-06-overview-board-card-actions`）。

## Acceptance Criteria

- [ ] `npx vitest run frontend/app/session-overview` → `passed`
- [ ] `npx vitest run frontend/app/view/term` → `passed`（agent-hover-card 相关）
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<= 47`（基线见 `docs/project/tsc-baseline.json`）
- [ ] `node scripts/verify/overview-board/verify.mjs` → `✅ 全绿`，且新增断言「点卡片 → `.agent-dialog` 出现」「点卡内详情 → 会话详情出现」
- [ ] `node scripts/verify/overview-timeline/verify.mjs` → `✅ 全绿`，且新增断言「bar 内段数 ≥ 2」「border-radius ≤ 4px」「完成点刻度存在」
- [ ] `node scripts/verify/agent-card-tags/verify.mjs` → `✅ 全绿`，断言「chip 数 = min(tags, 3)」「有 `+n` 时 n = tags-3」
- [ ] 原型先落地：`design/prototypes/overview-card-click/`、`design/prototypes/overview-group-views/`、`design/prototypes/overview-board-v2/timeline-gantt.html` 加 G2.1 分段版

## Notes

- 四个包共用同一批文件（`overview-board.tsx` / `overview-board-model.ts` / `session-overview.tsx` / `session-overview.scss`），
  所以合成**一个任务、4 个阶段顺序提交**，不拆 4 个任务（会互相撞写）。
- 每个阶段独立可验收、可回滚；阶段 4 依赖阶段 3 的 segments 模型，阶段 3 依赖阶段 2 的 `projectName` 已进模型。
