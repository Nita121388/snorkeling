# 技术设计（G1 时间线）

细节依据：`design/plans/overview-board-timeline.md`。本文只记实现落点与契约。

## 文件

| 文件 | 变更 |
|---|---|
| `frontend/app/session-overview/persisted-enum.ts` | 新增：把 `createPersistedEnum` 从 `overview-board-model.ts` 抽出（viewMode / boardGroup / timelineRange 三处共用） |
| `frontend/app/session-overview/overview-timeline-model.ts` | 新增：纯函数 + `overviewTimelineRangeAtom` |
| `frontend/app/session-overview/overview-timeline.tsx` | 新增：渲染（行 + 轨道 + 刻度 + now 线 + 空态） |
| `frontend/app/session-overview/overview-board-model.ts` | `OverviewViewModesImplemented` 加 `"timeline"`；枚举工厂改从 persisted-enum 导入 |
| `frontend/app/session-overview/session-overview.tsx` | 视图按钮改为按 mode 元数据渲染（图标/文案/顺序），时间线模式渲染 `<OverviewTimeline>` + 时间窗选择器 |
| `frontend/app/session-overview/session-overview.scss` | 时间线样式（轨道网格、条纹、now 线、窄面板横滚） |
| `scripts/verify/overview-timeline/verify.mjs` | 新增 area（照 `_template`，含播种 agent 块） |

## 纯函数契约（`overview-timeline-model.ts`）

```ts
export const OverviewTimelineRanges = [2, 8, 24, 168] as const;   // hours
export type OverviewTimelineRange = (typeof OverviewTimelineRanges)[number];
export const OverviewTimelineRangeDefault: OverviewTimelineRange = 8;

export type OverviewTimelineRow = {
    blockId: string;
    sessionId: string;
    title: string;
    avatar: OverviewBoardAvatar;
    providerLabel: string;
    projectName: string;
    messageCount: number;
    state: string | null;           // 当前 AgentDisplayState，用于尾巴着色
    startedAt: number;              // ms（createdAt，缺失时 = updatedAt）
    startUnknown: boolean;
    endedAt: number;                // live ? now : updatedAt
    lastActivityAt: number;         // = updatedAt（排序用）
    live: boolean;
};

export type OverviewTimelineBar = {
    leftPct: number;
    widthPct: number;
    tailPct: number;                // 0..100，占整条的比例（当前状态色段）
    state: string | null;
};

export function buildTimelineRows(cards, opts: { nowMs, statuses, summaries, windowMs }): OverviewTimelineRow[]  // 排序 + 过滤
export function buildTimelineBar(row: OverviewTimelineRow, opts: { nowMs, windowMs }): OverviewTimelineBar | null  // 完全在窗外 → null
export function buildTimelineTicks(rangeHours, nowMs): { label: string; leftPct: number }[]
export function formatTimelineRangeLabel(rangeHours): string        // "2h" / "24h" / "7d"
```

## 着色

- 尾巴 / 状态色一律走现有 CSS 变量：`--agent-working-color` / `--warning-color`(blocked) /
  `--agent-done-color` / `--agent-stale-color` / 中性灰（idle）。
- 历史段用 `repeating-linear-gradient` 斜纹，**不使用状态色**，tooltip 文案固定「状态未知」。

## 兼容 / 回滚

- `OVERVIEW_BOARD_ENABLED=false` → 只剩列表（时间线也不可用），保持单一回滚开关。
- 旧 storage 无 `timelineRange` → 默认 8h。
- 时间线只是 `viewMode` 的第三个分支；任何异常都退化为看板渲染不动（不做 try/catch，靠类型与单测兜底）。

## 风险

| 风险 | 处置 |
|---|---|
| 会话数多 → 行数爆炸 | 只显示「窗口内有活动」的会话；超出给一行「更早的 n 个会话未显示」 |
| `createdAt` 缺失导致条过短 | `startUnknown` 标记 + tooltip 文案；不伪造起点 |
| 窄面板刻度挤压 | 轨道 `min-width: 520px` + 横向滚动，刻度文字不换行 |
