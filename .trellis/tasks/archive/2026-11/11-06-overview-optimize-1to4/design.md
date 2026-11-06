# Overview 优化 1-4 · 技术设计

> 上游 `prd.md`。四个阶段共用同一批文件，按顺序提交，每阶段独立可回滚。

## 1. 改动边界（touch 白名单）

```
frontend/app/session-overview/overview-board-model.ts        # 分组枚举 + 分组函数 + 卡片模型（+tags）
frontend/app/session-overview/overview-board-model.test.ts   # 需要时新建/扩充（现有测试在 overview-board.test.ts）
frontend/app/session-overview/overview-board.test.ts
frontend/app/session-overview/overview-board.tsx             # 卡片点击语义 + tags chip + 迷你时间线
frontend/app/session-overview/overview-timeline-model.ts     # segments 模型
frontend/app/session-overview/overview-timeline-model.test.ts
frontend/app/session-overview/overview-timeline.tsx          # 分段渲染 + 完成点刻度 + 图例
frontend/app/session-overview/session-overview.tsx           # 接线（点击目标 / 分组选项 / boardCards 补 tags+segments）
frontend/app/session-overview/session-overview.scss          # 圆角 / 段缝 / tags chip / 迷你条
frontend/app/modals/agentcardmodal.tsx                       # 卡内「打开会话详情」入口
frontend/app/view/term/agent-hover-card.tsx                  # 修 embedded 下 onOpenCardDialog=undefined
frontend/app/element/info-card/session-note-section.tsx      # 若需 embedded 分支（最小改动）
scripts/verify/overview-board/verify.mjs                     # 新增点击语义断言
scripts/verify/overview-timeline/verify.mjs                  # 新增分段/圆角/完成点断言
scripts/verify/agent-card-tags/**                             # 新增 area（照 _template）
scripts/verify/README.md
docs/project/verify-ledger.md
docs/project/ui-verify-playbook.md
design/prototypes/overview-card-click/**
design/prototypes/overview-group-views/**
design/prototypes/overview-board-v2/timeline-gantt.html
design/prototypes/__REVIEW_GUIDE__.md
.trellis/tasks/11-06-overview-optimize-1to4/**
.trellis/spec/**
```

**出界即停**：不改 `pkg/**`（阶段 4 的「后端记历史」如果要做，另开任务，见 §5）。

## 2. 阶段 1 · 点击语义

### 2.1 接线

`session-overview.tsx` 的 `onOpenSession` 拆成两个回调：

```
onOpenCard(card)   → 非 agentLike 或 blockId 为空：保持现有「选中 + 跳 block」
                   → agentLike：setSelectedBlockId + markBlockViewed + pushModal("AgentCardModal", {blockId, blockData})
onOpenDetail(card) → 现有 openSessionDetail(sessionId)（供卡内按钮与列表/时间线复用）
```

`OverviewBoard` 的 prop 从 `onOpenSession` 改名 `onOpenCard`（语义更准），并新增可选 `onOpenDetail`（透传给卡内？不需要——卡内按钮由 AgentCardModal 自己提供，board 不需要）。

时间线视图 `OverviewTimeline` 的 `onOpenSession` **保持原语义**（点行 = 开会话详情），与列表一致。

### 2.2 AgentCardModal 内加「打开会话详情」

- 在 `AgentCardModal` 的 `Modal` 上加 `footer` 或 `headerExtra`：一枚 `打开会话详情` 按钮。
- 点击 → `modalsModel.pushModal("AISessionDetailModal", { sessionId })`；`sessionId` 从已有的 `resolveBlockSessionId` 取（本文件已算过，复用变量）。
- 没有 sessionId（空会话）时按钮 `disabled`。

### 2.3 embedded 下的 `onOpenCardDialog` —— 已核实是死代码，不是 bug

**（已读代码核实，推翻 prd/answer 页里的「embedded 下加不了属性」判断）**

- `session-note-section.tsx:285` 的 `onOpenCardDialog` 渲染**只在 `variant !== "hover"` 分支**（`:250` 的三元里，hover 分支只渲染 `titleNode` 或标题块）。
- `AgentHoverCard` 恒传 `variant="hover"`（`:306`），所以 `:308` 的 `onOpenCardDialog={embedded ? undefined : openCardDialog}` **永远不被消费**。
- 属性面板的「Add property」由 `canEditProperties` 控制（`:397` `onAddProperty={canEditProperties ? addProperty : undefined}`），与 `onOpenCardDialog` 无关。

**处置**：不做功能改动。只在阶段 1 顺手删掉这行死三元（`agent-hover-card.tsx:308` 整行删除），并在 PR 说明里写清「此前被误判为 bug」。
若担心删错，保留亦可 —— 它不是本任务验收项。

### 2.4 验收

- 单测：`overview-board.test.ts` 不需要渲染层测试（现有测试是纯函数），改的是 `session-overview.tsx` 接线 → 靠真机。
- 真机 `overview-board`：
  - 新断言 `card-click-opens-agent-dialog`：点 `.session-overview-board-card` → 500ms 内出现 `.agent-dialog`。
  - 新断言 `agent-dialog-has-detail-button`：`.agent-dialog` 内存在 `[data-agent-card-detail]`。
  - 新断言 `agent-dialog-detail-opens-session`：点它 → 出现会话详情（`.session-detail` 或现有详情锚点，实施时确认）。
  - 回归：原 `board-hides-list-rows` 等断言不得因新增弹窗而误判（断言都 scope 到 overview block，弹窗在 body 层，需确认 scope 不串）。

## 3. 阶段 2 · 目录 / 标签分组

### 3.1 枚举与持久化

```ts
export const OverviewBoardGroups = ["status", "tab", "provider", "project", "tags"] as const;
```

`isOverviewBoardGroup` 自动放行（它读这个常量）；`overviewBoardGroupAtom` 的 `createPersistedEnum` 校验也走 `isOverviewBoardGroup`，
**旧版本写入的非法值仍回落到 `status`**（`persisted-enum.ts` 已有回落逻辑，不用改）。

### 3.2 分组函数

```ts
groupOverviewCardsByProject(cards)  // key: `project:<basename>`，无项目 → `project:__none__`，title「无项目」
groupOverviewCardsByTags(cards)     // key: `tag:<tag>`，无标签 → `tag:__untagged__`，title「无标签」
```

- `OverviewBoardCardRef` 需要扩两个可选字段：`projectName?: string`（已有 `OverviewBoardCard` 上就有）、`tags?: readonly string[]`。
  为了不动 `groupOverviewCardsByTab/Provider` 的现有签名，把 `projectName` / `tags` 加成**可选**字段。
- `project` 列序：卡片数降序 → 标题升序；「无项目」永远最后（照抄 `groupOverviewCardsByProvider` 的 fallback 规则）。
- `tags` 列序：**字母序**（`localeCompare`），「无标签」永远最后；卡可跨列（同一 blockId 出现在多列）。
- 两个都不补空列。

### 3.3 面板接线

`session-overview.tsx` 的 `<select>` 加两个 `<option>`：`目录`、`标签`。
`boardCards` 补 `tags: summary?.tags ?? []`（`OverviewBoardCard` 加字段）。

### 3.4 验收

- 单测新增：
  - `project` 分组：两个项目 + 一个无项目 → 3 列、无项目在最后、列序按卡片数。
  - `tags` 分组：一张卡带 2 个 tag → 出现在 2 列；无 tag 卡在「无标签」列且该列最后。
  - `isOverviewBoardGroup("project"/"tags") === true`；`"bogus" === false`。
- 真机：`overview-board` 加断言「切到 project → 列头含项目名」「切到 tags → 列数 = 唯一标签数 + 1（有 untagged 时）」。

## 4. 阶段 3 · 卡片标签 + 迷你时间线

### 4.1 标签 chip

- `OverviewBoardCard` 新增 `tags: readonly string[]`。
- 渲染：meta 行 `visibleChips` 之后追加 tags；样式 class `session-overview-board-chip is-tag`（令牌抄 `property-chip` 的边框/底色，不新增设计变量）。
- 截断：最多 3 个，超出显示 `+n`（`n = tags.length - 3`），整行 `flex-wrap: nowrap` + `overflow: hidden`，**卡片高度不变**。
- 纯函数 `resolveBoardTagChips(tags, max)` → `{ visible: string[], hiddenCount: number }`（可单测）。

### 4.2 迷你时间线

- 新纯函数在 `overview-timeline-model.ts`：
  ```ts
  export type OverviewSegment = { state: string; fromMs: number; toMs: number };
  export function buildTimelineSegments(row, history, { nowMs, windowMs }): OverviewSegment[]
  ```
  - `history` 缺失/空 → 单段 `{state: row.state ?? "unknown", fromMs: row.startedAt, toMs: row.endedAt}`（**G1 退化路径，保证阶段 3 不依赖后端**）。
  - `history` 有值 → 按时间排序、窗口裁剪、缺口补 `unknown`。
- 卡片迷你条：`buildTimelineSegments` → 取最近 N 段（默认 12）→ 按 `width%` 铺满一行，高 3px，圆角 2px。
- **阶段 3 不读后端历史**（`history` 传 `undefined`），所以视觉上是「单段当前态 + 全灰历史」；阶段 4 才接真实历史。

### 4.3 验收

- 单测：`resolveBoardTagChips` 0/1/3/5 个 tag 的 visible 与 hiddenCount；`buildTimelineSegments` 无历史退化、有历史裁剪、缺口补 unknown。
- 真机新 area `agent-card-tags`：断言 `chip 数 = min(tags,3)`、`+n` 的 n 值、卡片高度与无 tag 卡一致（±2px）。

## 5. 阶段 4 · 甘特重修

### 5.1 数据来源（关键决策）

两个选项，本阶段选 **A**，B 另开任务：

| 方案 | 做法 | 代价 | 本次是否做 |
|---|---|---|---|
| **A 前端退化分段** | `history` 传 `undefined`；条 = `[unknown 段 | 当前状态段]`，当前状态段从 `activeSince ?? completedAt ?? updatedAt` 起算 | 零后端改动；仍然「不精确」但**比现在的 `tailMsFor` 猜法诚实**：段起点来自真实字段而不是 6min/20% 公式 | ✅ |
| B 后端环形历史 | `pkg/agentstatus` 在 `report()` 里 append `{t, state}` 到 ring buffer，新 RPC 暴露 | 需改 Go + 新 RPC + 前端 store | ❌ 另开任务 |

**为什么 A 能解决用户的三个抱怨**：
- 「看不出运行阶段」→ 段的**起点**变成 `activeSince`（真实报告时刻），不再是从尾巴倒推的 6 分钟。
- 「看不出完成时间点」→ `completedAt` 进模型，画竖刻度。
- 「看不出 idle 多久」→ 末段（当前态）宽度 = `now − activeSince`（idle 时即 `now − completedAt`），有真实依据。
- 「圆角太大」→ CSS 改。

**残留不诚实之处**：A 仍无法画出「working → idle → working → idle」的多次交替。这一点写进
`overview-timeline.tsx` 的图例 tooltip 与 `design/plans/overview-board-timeline.md`，等 B 落地。

### 5.2 模型改动

```ts
// 旧：tailPct（猜）
// 新：
export type OverviewTimelineBar = {
    leftPct: number;
    widthPct: number;
    segments: OverviewSegmentPct[];   // {state, widthPct}
    completedPct: number | null;      // completedAt 在窗口内的位置，null = 无/超窗
};
```

`buildTimelineBar(row, {nowMs, windowMs})` 内部改用 `buildTimelineSegments`。
**保留** `tailPct` 字段一个版本（标 `@deprecated`）以免 `overview-timeline-model.test.ts` 全红；新测试用 `segments`。

### 5.3 渲染与样式

- `.session-overview-timeline-bar` → `border-radius: 4px`；段 `.bar-seg` → `border-radius: 3px`；段间 `gap: 1px`（`display:flex` + `gap`）。
- 段色：`working` / `blocked` / `done` / `idle`（中性灰）/ `unknown`（斜纹）。
- 完成点：`.bar-completed` 绝对定位 1px 竖线 + `data-*` 供真机断言；hover 时 title 追加 `HH:MM 完成`。
- 图例四项：「运行 / 空闲 / 完成 / 状态未知」。

### 5.4 验收

- 单测：idle 行的末段宽度 = `now − completedAt` 折算的百分比（±0.5%）；有 `activeSince` 的 working 行段起点 = `activeSince`；
  `completedPct` 在 `completedAt` 超窗时为 `null`。
- 真机 `overview-timeline`：断言 `segments >= 1`（A 方案下通常 1-2）、`border-radius <= 4px`、
  `completed` 刻度元素在 `completedAt` 有值的行上存在。

## 6. 原型（先于实现）

| 原型 | 内容 | 定什么 |
|---|---|---|
| `design/prototypes/overview-card-click/index.html` | 三级栈：board 卡片 → 整卡弹窗 → 会话详情；含「点卡片本体 vs 点卡内按钮」的冒泡演示 | 定弹窗层叠与关闭路径 |
| `design/prototypes/overview-group-views/index.html` | 目录视图 / 标签视图两套列布局（含多标签卡跨列的表现与图例） | 定列头、空列、跨列说明 |
| `overview-board-v2/timeline-gantt.html` | 加 G2.1：真实分段 + 3px 圆角 + 完成点刻度 + idle 实心灰 | 定分段配色与完成点标记 |

原型只写 HTML/CSS/JS，无依赖，浏览器直开；`__REVIEW_GUIDE__.md` 登记。

## 7. 回滚

每个阶段一个独立 commit：

- 阶段 1：`git revert` 单提交 → 卡片点击回落到开会话详情（`onOpenCard` 与 `onOpenDetail` 合并回原 `onOpenSession`）。
- 阶段 2：`OverviewBoardGroups` 去掉两个值即可；`persisted-enum` 对非法值回落 `status`，**已存过 `project` 的用户回滚后自动回落**，无脏数据。
- 阶段 3：`OverviewBoardCard.tags` 可选，去掉渲染块即回退；`buildTimelineSegments` 是纯新增函数，不删也不影响。
- 阶段 4：`tailPct` 保留一个版本 → 只回滚渲染与 CSS 即可回到胶囊尾巴；`segments` 字段多出来的不影响旧渲染。

## 8. 风险

| 风险 | 处置 |
|---|---|
| 真机断言被弹窗污染（弹窗在 body 层，overview 断言 scope 到 block） | 断言前后都 scope；新增断言显式查 `document.querySelector(".agent-dialog")` 并先关弹窗 |
| `tags` 分组让「列计数之和 = 卡片数」的既有断言失败 | 阶段 2 显式改断言为「列计数之和 ≥ 卡片数」，并注明原因 |
| `session-note-section.tsx` 的 `onOpenCardDialog` 用途未核实就改 | 阶段 1 第一步先读该文件 hover 分支，按 §2.3 的两个分支选最小改法 |
| 阶段 4 A 方案仍不显示多次交替 | 图例 tooltip 明说「历史段为推断」，并登记后续任务（后端 ring buffer） |
