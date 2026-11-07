> **Confirmed: 2026-11-06 @nita**

# Agent 卡片统一：状态 chip 收口 + 运行时长 + 标题内联编辑

## Goal

Agent 状态的「徽章」在仓库里有 4 份互不相干的实现（Overview 列表/看板、悬浮卡/放大弹窗、Tab 聚合、Block 头部），
几何与排版各写一份，导致同一状态换个位置就塌（悬浮卡文字不垂直居中、跑时只在部分面出现）。
本次把它们收口到**一个** `AgentStatusChip` 组件（判定、文案、跑时、ack 语义只有一份，几何靠 `variant` 区分），
让 chip 在所有面都显示**运行时长**，并让 agent 卡片（悬浮态与放大弹窗）支持**编辑会话标题**。

## 现状证据（2026-11-06 只读核查）

| 面 | 当前实现 | 几何 | 有跑时 |
|---|---|---|---|
| Overview 列表 + 看板 | `frontend/app/session-overview/agent-status-chip.tsx` | 18px / 10px / 圆角 6 | ✅ `statusDurationText` |
| 悬浮卡 + 放大弹窗 | `agent-hover-card.tsx:238` + `info-card.scss:322` | 20px / 10.5px / 胶囊 999 | ❌ 只有未读 Done 的 elapsed |
| Tab 聚合 | `session-overview.tsx:946` `AggregateStatusChip` | 18px / 聚合文案 | ❌ |
| Block 头部 | `term-model.ts:637` `HeaderElem` 文本 | 纯文本 | ❌ |

共享的只有判定层（`agent-status-derive.ts` / `agent-status-view.ts`）。
标题编辑现状：`agentcardmodal.tsx:44` 把标题当纯文本塞进 `Modal title`；`SessionNoteSection` 的 `hover` 分支只渲染文本；
`useSessionNoteState` 只有 `applyTitle()`（AI 提案），**没有手动改名**。

## 做什么

### R1 单一 chip 组件

- `AgentStatusChip` 成为**唯一**状态徽章组件，签名：

  ```tsx
  <AgentStatusChip
    status={AgentStatus}
    now={number}            // 跑时用；由组件内部 tick 刷新，见 R2
    variant="list" | "board" | "card" | "header" | "aggregate"
    unread={boolean}
    onAck={(blockId, status) => void}   // aggregate 变体改为 () => void
    aggregate?: AgentStatusAggregate     // 仅 aggregate 变体
  />
  ```

- `variant` 只决定**几何与装饰**：高度、字号、圆角（6 vs 胶囊）、是否渲染状态 icon、是否渲染 dot、是否渲染跑时。
- 状态词、tooltip 文案、跑时格式、`is-acked` / `is-inferred` / `is-unread` 类名、ack 语义**只有一份实现**。
- 4 个调用点全部替换：`session-overview.tsx`（列表行 + Tab 聚合）、`overview-board.tsx`（看板卡片）、`agent-hover-card.tsx`（悬浮卡 + 弹窗）、`term-model.ts`（Block 头部）。
- `term-model.ts` 是 **viewText atom 的 `HeaderElem`**，不是 React 组件。允许它继续走 `HeaderElem`，但必须消费同一个纯函数
  `buildAgentStatusChipView(status, view, nowMs)`（新增于 `agent-status-chip-view.ts`）产出 `text` / `className` / `title`，
  **禁止**再自己拼 label / 类名 / 跑时。React 侧的 `AgentStatusChip` 也从这个纯函数取数据。

### R2 运行时长

- 所有 variant 在 `working` / `blocked` 态显示运行时长，`idle` / `unknown` 不显示（沿用现有 `shouldShowAgentStatusChip` 语义）。
- 起点 `status.activeSince ?? status.updatedAt`（现有口径不变）。
- 格式（带单位，不用 `00:00` 那种计时器样式）：`< 60s` 用 `7s`，`< 60min` 用 `3min21s`，
  `< 24h` 用 `1h12min`，`>= 24h` 用 `2d3h`。**秒级**刷新。
- 刷新机制：新增 `agentStatusSecondTickAtom`（1s 单例 `setInterval`，模块加载即启动，`globalStore.set`）。
  **只有 chip 自己订阅**，`React.memo` 包裹 chip 并按 `status` / `unread` / `variant` 比较。
  `document.hidden === true` 时该 tick 不写 atom（暂停）；重新可见时立刻补一次。
- **禁止**把 `SessionOverviewPanel` 的 `useNow` 从 `30_000` 改成 `1_000`：`now` 是面板 state，
  且被 `boardCards` / `timelineRows` 两个 memo 与看板动效层 `useLayoutEffect` 依赖，
  改快会让整树重渲染 + 全量 rect 采样（`session-overview.tsx:2138` / `:2361`、`overview-board.tsx:207`）。

### R3 标题编辑

- 新增 `EditableTitle` 组件（`frontend/app/element/info-card/editable-title.tsx`）：
  - 展示态：`<span className="info-card-title" title={full}>`（截断 + tooltip），带 `TitleSourceBadge`
  - 编辑态：`<input>`（`h-6 rounded border border-accent bg-surface`，与 `session-detail.tsx:121` `RenameTitleInputClass` 同一套视觉）
  - 提交：`Enter` / `blur` → 调 `renameSessionTitle()`；`Escape` → 放弃
  - 空串或与现值相同 → 直接退出，不发请求
- `useSessionNoteState` 新增 `renameTitle(next: string)`，内部：
  `service.Title(sessionId, next, connection || "")` → `dispatchAISessionNoteUpdated(updated)` → 清 `error`
  （与 `applyTitle` 同一条通道，见 `session-note-hook.ts:397`）
- 入口：
  - **放大弹窗**（`AgentCardModal`）：`Modal` 的 `title` 换成 `<EditableTitle>`，**双击**进入编辑
  - **悬浮卡**（`SessionNoteSection variant="hover"`）：标题块同样换成 `<EditableTitle>`，**单击**进入编辑；
    编辑中通过 `InfoCardPortal` 的 `cardProps` 焦点保活（现有机制，见 `agent-hover-card.tsx:305`）防止 hover 离开打断
  - 编辑中 `Escape` 只退出编辑，**不关闭弹窗**（`Modal` 需感知 `isEditing` 并抑制 ESC 关闭）
- 弹窗 header 与卡内标题必须**同源同帧**：改名后 header、卡内标题、Overview 卡片、Tab 悬浮卡一起变（靠 note-cache merge）。

### R4 标题写入不得污染 agent 状态

`SetTitle` 会 bump `UpdatedAt`（`pkg/aisessions/sqlite_index.go:939`），而 `presentAgentStatus` 有一条
「canonical idle + 未读 session 活动 + 15 分钟内 → 呈现为 `done`」的判定（`agent-status-derive.ts:174`）。
若不处理，**用户改个标题会让一个 idle 会话在所有面亮成「Done 未读」**。

- 本包采用**前端方案**：`renameTitle` 成功后，若该 block 的当前呈现态是 `done` 且此前的 `updatedAt` 不是本次写入造成的，
  则立即 `ackAgentStatusUnified(blockId, status, "title-edit")` 把这次自己写的更新 ack 掉。
- 不新增后端字段、不改 `AgentStatus` 契约。

### R5 视觉一致（几何判据）

- 每个 variant 的 chip 内 `label` 文本墨迹中心与 chip 盒中心垂直偏差 **≤ 1px**（实测值，不是"看着对"）。
- 4 个面的 chip 在同一状态下**文案完全一致**（除 `aggregate` 变体的聚合文案）。

## 不做什么

- 不改 `deriveAgentStatus` / `presentCanonicalAgentStatus` / `deriveAgentStatusView` 的**判定语义**（只消费，不改规则）。
- 不改 `activeSince` 的后端口径（`pkg/agentstatus`），不新增后端字段。
- 不做标题的 AI 生成入口改造（`GenActionButton kind="title"` 保持原样；本包只加**手动**编辑）。
- 不改 hover 卡的其它属性行（tags / note / 自定义属性）的编辑方式。
- 不改 Overview 的 30s `useNow`，不改看板动效层的采样逻辑。
- 不合并 `Modal` / `FlexiModal` 两套弹窗壳（那是 `11-02-modal-single-shell-refactor`）。
- 不做 chip 的交互改造（ack 语义、点击行为保持现状）。

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/` → `156 passed`（基线 140 + 新增 16）
- [ ] `npx vitest run frontend/app/agent-status/` → `240 passed`（基线 224 + 新增 16）
- [ ] `npx vitest run frontend/app/element/info-card/` → `48 passed`（基线 36 + 新增 12）
- [ ] `npx vitest run frontend/app/view/term/` → `198 passed`（基线 186 + 新增 12）
- [ ] `npx vitest run frontend/app/modals/` → `43 passed`（基线 39 + 新增 4）
- [ ] `npx vitest run frontend/app/store/` → `92 passed`（基线 86 + 新增 6）
- [ ] `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `47`（既有基线，不涨）
- [ ] `node scripts/verify/index.mjs` → `agent-card-seen` 与 `overview-board` 两个 area 各自退出码 `0`
- [ ] `node scripts/verify/agent-card-seen/verify.mjs` → `N/N` 全绿，且新增断言见下

新增判据必须能看见本包的缺陷（修复前必须红）：

- **chip 统一**：新增单测断言 `buildAgentStatusChipView()` 对同一 `status` 在 4 个 variant 下产出**相同 `text`**；
  对旧实现（各面自己拼）必须红 —— 旧代码里悬浮卡根本不产出跑时文本。
- **跑时**：新增单测断言 `formatAgentChipRuntime()` 在 `7_000ms → "7s"`、`59_000ms → "59s"`、
  `201_000ms → "3min21s"`、`3_600_000ms → "1h0min"`、`90_000_000ms → "1d1h"`；
  断言 `working` 态 `buildAgentStatusChipView().runtime !== ""`，
  `idle` 态 `runtime === ""`。
- **垂直居中**：`scripts/verify/agent-card-seen` 新增断言
  `|labelRect.centerY − chipRect.centerY| <= 1`，对修复前的 20px/10.5px 悬浮卡必须红。
- **标题编辑**：新增单测断言 `useSessionNoteState().renameTitle("New")` 触发 `service.Title` 且成功后派发 `dispatchAISessionNoteUpdated`；
  断言改名后 chip 呈现态**不是** `done`（R4 回归锁）。

## G1 签字

- [ ] nita 确认「做什么 / 不做什么 / 验收判据」三段
