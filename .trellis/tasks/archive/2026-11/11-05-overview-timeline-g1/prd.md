# Overview 时间线 G1：会话寿命条

> 原型已签：`design/prototypes/overview-board-v2/timeline-gantt.html`（G1 模式）
> 设计文档：`design/plans/overview-board-timeline.md`
> 上游：A（卡片信息架构）/ B（5 列看板）/ C（视图切换，`OverviewViewMode` 已预留 `timeline`）
> 用户 2026-11-05：「ok 进入开发吧」= 按推荐先落 G1，不做 G2 埋点。

## Goal

给 Overview 加第三种视图「时间线」：一眼看出每个 agent 会话起了多久、什么时候停的、现在还活着吗。

## Requirements

- R1 视图接入：`OverviewViewModesImplemented` 加 `"timeline"`，header 分段切换器出现第 3 枚按钮
  （`data-overview-view="timeline"`），列表/看板行为不变。
- R2 时间窗：2h / 8h / 24h / 7d 四档，默认 **8h**；选择持久化（`snorkeling.overview.timelineRange`），
  非法值回落默认。时间窗只在时间线视图显示。
- R3 行：一行一个 agent 会话（复用看板卡片的身份：emoji/logo 头像 + 标题 + provider · 项目 · 消息数），
  按最后活动时间**倒序**（最上面是最新的）。点击行 = 打开会话详情，与卡片一致。
- R4 条：`createdAt → (live ? now : updatedAt)`，裁剪到时间窗；
  尾巴一小段 = **当前状态色**（working/blocked/done/idle/stale，与列头色点同一套 token），
  历史段 = 中性斜纹 + tooltip 标「状态未知」；`createdAt` 缺失 → 从 `updatedAt` 起算并标 `start unknown`。
- R5 刻度：随窗口变化（≤8h 用 `HH:MM`，≥24h 用 `MM/DD HH:MM`）；`now` 线固定在右端。
- R6 空态：时间窗内没有任何会话 → 一行文案，不画空轨道。
- R7 纯函数化：窗口/行/条/刻度的计算全部在 `overview-timeline-model.ts`，可单测。

## Acceptance Criteria

- [ ] header 出现三枚视图按钮，点「时间线」进入时间线；点回列表/看板行为不变
- [ ] 行数 = 有会话的 agent 数；每行至少 1 段；刻度数恒定；now 线在右端
- [ ] 切 2h/8h/24h/7d 后条长与刻度文案随之变化，选择在 reload 后保持
- [ ] 尾巴颜色 = 当前状态（用播种 agent 块 + AgentStatus 验证）
- [ ] 单测覆盖：窗口裁剪、createdAt 缺失、live 延到 now、倒序、刻度文案、range 持久化回落
- [ ] 真机新 area `overview-timeline` 全绿并入台账；既有 `overview-board` 38 条零回归

## 非目标

- G2 状态分段（需 per-block 状态历史，环形 buffer）；
- 「更早（n）」折叠、跨天排期、资源利用率。
