# Overview 时间线（甘特）设计

> 状态：**原型阶段，未实现**。原型：`design/prototypes/overview-board-v2/timeline-gantt.html`
> 上游：`11-05-overview-board-v2`（卡片信息架构 + 5 列看板已发）、`11-05-overview-board-view-switch`（视图三段切换已留接口）。
> 日期：2026-11-05

## 1. 目标与非目标

**目标**：一眼回答「每个 agent 起了多久、什么时候停的、现在还活着吗」。

**非目标**：不做资源利用率、不做计划 vs 实际对比、不做跨天甘特排期（这是 agent 会话，不是项目任务）。

## 2. 数据现状（决定能做哪一版）

| 字段 | 来源 | 说明 |
|---|---|---|
| `createdAt` | `SessionSummary` | 会话文件创建时间（部分历史会话缺失） |
| `updatedAt` | `SessionSummary` | 最后一条消息时间 |
| `messageCount` / `projectPath` / `title` | `SessionSummary` | 卡片已有信息 |
| `live` | `SessionSummary` | 是否仍在写入 |
| `state` / `phase` / `activeSince` / `updatedAt` / `completedAt` | `AgentStatus` | **只有当前态** |
| 历史状态转移 | ❌ 不存在 | 这是 G2 唯一的阻塞点 |

结论：**G1 零埋点可做；G2 需要新增 per-block 状态历史。**

## 3. G1 · 会话寿命条（推荐先做）

- 每条 = `createdAt → (live ? now : updatedAt)`
- 尾巴最后一小段用**当前状态色**（与列头色点、卡片 chip 同一套 `--agent-*` token）
- 历史段用中性斜纹 + tooltip 注明 `状态未知`
- `createdAt` 缺失时从 `updatedAt` 起算，tooltip 标 `start unknown`
- 排序：最后活动时间倒序；超窗的会话灰显排底并在行尾给「更早」箭头

## 4. G2 · 状态分段（后续，独立可回滚）

**存储**：`agent-status` 侧新增环形历史

```
key:   snorkeling:agent-status-history
value: { [blockId]: Array<{ t: number; s: string; p?: string }> }   // t=ms, s=state, p=phase
cap:   每块 200 条（约 8KB），全局 1MB 上限 + LRU 淘汰最旧块
write: 只在 presented 状态变化时 append（唯一写点，避免高频抖动的 re-render 写盘）
```

**读取**：纯函数 `buildTimelineSegments(history, window, now)` → `[{state, fromMs, toMs, inferred}]`
（窗口裁剪、缺口补 `unknown`、首段用 `createdAt` 补齐），可直接单测。

**渲染**：与 G1 共用同一份 `segments` 模型 —— G1 就是「单段 unknown + 尾巴当前态」，所以 G2 落地时**组件结构不变**。

## 5. 组件与状态

```
frontend/app/session-overview/overview-timeline.tsx     // 渲染（行 + 轨道 + 刻度 + now 线 + hover）
frontend/app/session-overview/overview-timeline-model.ts // 纯函数：window 计算、排序、segments、刻度
```

- 状态：`overviewTimelineRangeAtom`（2h/8h/24h/7d，默认 8h，atomWithStorage，key `snorkeling.overview.timelineRange`）
- 复用：`OverviewViewModesImplemented` 加 `"timeline"`；header 分段切换器已经支持第 3 枚按钮，**不需要再改结构**
- 点击行为：点条 = 打开会话详情（与卡片一致）

## 6. 验证设计

- 单测：`buildTimelineSegments` 窗口裁剪 / 缺口补 unknown / 排序 / 空数据
- 真机（`scripts/verify/overview-timeline/`，新 area，照 `_template`）：
  - 行数 = agent 块数；每行至少 1 段；刻度数恒定；`now` 线只在窗口右端
  - 切 2h/24h 后刻度文案格式变化（小时 vs 日期）
  - 窄面板横向可滚且 snap 生效
  - 播种 agent 块（复用 overview-board 的做法）验证「尾巴颜色 = 当前状态色」

## 7. 风险

| 风险 | 处置 |
|---|---|
| 历史会话 `createdAt` 缺失 → 条长严重偏短 | tooltip 标 `start unknown`，并在行首加淡色问号 |
| 会话数很多时行数爆炸 | 默认只显示「最近 8h 有活动」的会话，其余折叠到「更早（n）」 |
| G2 写盘频率 | 只在 presented 状态变化时写，且 ring buffer 不整表重写（按 block 分 key 或 debounce 500ms） |
