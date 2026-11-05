# 技术设计：Overview 看板 v2（A + B）

## 1. 现状证据（改前必读）

| 现象 | 根因 | 位置 |
|---|---|---|
| 只剩一列，像列表 | `groupBlocksByStatus()` 未传 `includeEmpty`，默认丢弃空列；5 个状态只有 1 个有卡 | `overview-board-model.ts`（`includeEmpty` 默认 false）/ `overview-board.tsx` 调用处 |
| 列纵向堆叠 | 仅 `@container (min-width: 1160px)` 才 `grid-auto-flow: column`；窄面板走 `grid-template-columns: 1fr` | `session-overview.scss`（board 段 + container query） |
| agent 显示 "Terminal" | 卡片标题直接吃 `blockTitle()`，agent 块无 `frame:title` → 回退 `blockViewToName(view)` = "Terminal"；列表行 agent 模式不渲染标题，故只在此暴露 | `session-overview.tsx` `blockTitle()` / `overview-board.tsx` |
| 无 emoji / 品牌图标 | `OverviewBoardItem` 只有 `agentProvider`，卡片头是 8px 色点；列表行走 `getAgentIcon()` | `overview-board.tsx` / `session-overview.tsx` BlockRow |
| 状态只有颜色没有词 | 列表用 `.session-overview-agent-status` chip（icon+label+age+ack）；看板只映射 dot | `session-overview.tsx` `AgentStatusChip` |

## 2. 边界与契约

### 2.1 组件边界

- `OverviewBoard` 保持**纯展示**：只吃 props，不读 store（可测、可复用）。
- 身份解析、状态 chip、note/preview 取值全部在 `SessionOverviewPanel` 里组装成
  `OverviewBoardCard` 数据再传入 —— 与列表行使用同一批 helper，避免第三份映射。
- `BoardCard` 内允许一个 hook：`useAgentReadContext(blockId, status)`（读/未读唯一判定），
  因为它是订阅型、低频写。

### 2.2 卡片数据模型（`overview-board-model.ts` 新增）

```ts
export type OverviewBoardAvatar =
    | { kind: "emoji"; emoji: string }
    | { kind: "logo"; icon: React.ReactNode; color?: string }
    | { kind: "icon"; iconClass: string };

export type OverviewBoardCard = {
    blockId: string;
    tabId: string;
    title: string;            // 已解析，agent 块用会话标题
    isAgentLike: boolean;
    avatar: OverviewBoardAvatar;
    providerLabel: string;    // "Claude" / "Codex" / ""（config 的 raw provider → 展示名）
    projectName: string;      // projectPath / cwd 的 basename
    tabName: string;
    preview: string;          // 最后一条可读消息；note 另起一行，不再抢 preview
    note: string;
    updatedAt: number;        // ms，0 = 不显示
    status: AgentStatus | null;
};
```

纯函数（可单测）：
- `resolveBoardCardTitle({ isAgentLike, sessionTitle, note, projectName, tabName, providerLabel, blockTitle })`
  - agent：`sessionTitle → note → projectName → "providerLabel · tabName" → "Agent"`
  - 非 agent：`blockTitle`（已带 cwd basename 改进）→ `tabName`
- `providerDisplayLabel(provider)`：`claude-code`/`claude` → `Claude`，`codex` → `Codex`，未知 → 原串 title-case
- `projectNameFromPath(path)`：basename（去尾斜杠，兼容 `\`）
- `formatBoardAge(updatedAt, now)`：`now/12m/3h/2d`（从组件搬到 model）

### 2.3 标题回退（`blockTitle()`，`session-overview.tsx`）

保持现有优先级，仅在末尾补 cwd basename 兜底：

`frame:title → display:name → meta.file → meta.url → basename(meta["cmd:cwd"]) → blockViewToName(view)`

- 非 agent 的 term 块因此显示 `proj` 而不是裸 `Terminal`；真无 cwd 时仍是 `Terminal`（正确）。
- 列表行、aria-label 一并受益；不改写 `blockViewToName`。

### 2.4 状态 chip 抽公共组件

新增 `frontend/app/session-overview/agent-status-chip.tsx`：
- 从 `session-overview.tsx` **原样搬出** `AgentStatusChip`、`statusDurationText`、`shouldShowAgentStatusChip`。
- `session-overview.tsx` 改为 import（列表行为零变化）。
- 看板卡片复用同一组件 → 颜色/文案/ack 落点天然一致，满足「跨面一致性」方向（11-03 后续换
  `AgentStatusView` 时只需改这一处）。

### 2.5 多列布局（B）

CSS 目标态（取代 container-query 纵向堆叠）：

```scss
.session-overview-board {
    display: grid;
    height: 100%;
    grid-auto-flow: column;
    grid-auto-columns: minmax(220px, 1fr);
    grid-template-columns: none;
    grid-template-rows: minmax(0, 1fr);
    gap: 12px;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x proximity;
}
.session-overview-board-column { scroll-snap-align: start; }
```

- 5 列常显：调用 `groupBlocksByStatus(..., { includeEmpty: true })`；空列渲染 `.session-overview-board-empty`（"暂无"）。
- 列头：状态色点 + 标题 + 计数（点样式从卡片 dot 提升为 `.session-overview-board-column-dot`，
  卡片不再需要 dot —— 状态由 chip 表达）。
- 列内 `.session-overview-board-cards` 继续 `overflow-y: auto`，与横向滚动互不干扰。
- 面板高度不受影响：`height: 100%` + `min-height: 0` 链保持；若真机出现嵌套滚动打架，
  回退为 `max-height: 100%`（验证台有卡片/列断言兜底）。

## 3. 兼容 / 回滚

- `OVERVIEW_BOARD_ENABLED = false` 仍回到纯列表。
- `overviewViewModeAtom` **不动**（仍 list/board 二值，C 批次再迁移）。
- 老数据无 summary（扫盘未命中）：标题回退到 `providerLabel · tabName`，不崩、不显示空标题。

## 4. 验证设计

- 单测：`overview-board.test.ts` 新增标题解析 / provider 文案 / 项目名 / formatBoardAge / includeEmpty 用例。
- 真机：`scripts/verify/overview-board/verify.mjs` 扩展
  - `board-columns-all-six`：列数 === 5
  - `board-empty-column-placeholder`：至少 1 个空列且有占位文案
  - `board-card-avatars`：至少 1 张卡有 `.session-overview-board-card-avatar`
  - `board-card-status-chip`：至少 1 张卡有 `.session-overview-agent-status` 且 label 非空
  - `board-no-terminal-agent-title`：`data-agent-like="true"` 的卡标题 !== "Terminal"
  - `narrow-board-horizontal-scroll`：窄宽 `scrollWidth > clientWidth` 且 `scroll-snap-type` 含 `x`
  - `wide-board-single-row`：6 列 top 一致（单行）
  - 既有 list/toggle/persistence 断言全部保留
- 像素：`02-board`（窄）、`02b-board-wide`（宽）两档人工过目 + 入 `verify-runs/`。

## 5. 风险

| 风险 | 处置 |
|---|---|
| 5 列常显在极窄面板只剩 1 列可见 → 又像列表 | 横向 snap + 列头常显 + 相邻列露边（`minmax(220px)` 而不是 100% 宽） |
| 嵌套滚动（body / board / column） | 真机验证断言 + 必要时限制 board 高度 |
| `AgentStatusChip` 抽文件引发循环依赖 | 新文件只依赖 `agent-status` 与 `util`，不 import `session-overview.tsx` |
| 与并行开发冲突（多 worktree） | 本轮只在 main 串行写 A→B，不并行派 subagent |
