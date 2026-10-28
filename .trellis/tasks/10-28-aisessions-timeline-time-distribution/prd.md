# aisessions 批注时间线：按时间分布节点

## Goal

rail 节点当前按 seq 均分（稀疏按 rank 等比、密集按固定 28px 槽）。改为按真实时间戳分布，忙时挤、闲时疏。

## 现状

`annotation-rail.tsx` 的 `topFor` 使用 `buildSeqRanks`（rank/maxRank 等比）或 `index*RailDotGap`。

## Requirements

- 从 `Message.timestamp`（已在 SQLite 持久化）建 `seq → ts` 映射。
- 新增纯函数 `buildTimelinePositions`：归一化到 [0,1]，时间缺失或跨度为 0 时回落 index 均分。
- 最小间距松弛 `relaxTimelinePositions`：时间挤在一起时防重叠，尽量保留相对比例。
- 密集分支（过多节点）保留固定槽 + 内部滚动，不做时间轴。
- 时间跨度跨天时点会集中在一端，这是正确表现；不加复杂日期分隔（后续单独议题）。

## Acceptance Criteria

- [ ] 稀疏节点按时间戳比例分布（两个相隔 10 小时的批注不再等距）。
- [ ] 同时间戳多个节点不重叠（最小间距）。
- [ ] `timestamp` 全 0 / 缺失时行为等同旧的均分，不崩。
- [ ] 单节点居中。
- [ ] 新增单测覆盖时间分布 + 回落 + 松弛。
