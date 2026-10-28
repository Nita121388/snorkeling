# aisessions 批注时间线：滚动位置可视化

## Goal

时间线要像时间轴：用户滚动会话详情时，rail 上能看出当前查看的位置在哪个批注节点附近。

## 现状

`AnnotationRail` 的 `activeSeq` 只在点击跳转时 set，1200ms 后清空；滚动时整条 rail 是静的。

## Requirements

- 复用右侧大纲轨已有的滚动探针结果（虚拟路径 `activeSeqFromVirtualItems`，全量路径 `useActiveOutlineSeq`），把「当前 message seq」映射成「最近一个已批注 seq」，作为 `scrollSeq` 传给 rail。
- rail 区分两种高亮：`scrollSeq`（连续，跟随滚动）+ `flashSeq`（点击跳转 1200ms 闪光）。
- 不新增消息列表 scroll listener；虚拟路径零额外成本，全量路径 ≤60 行可接受。

## Acceptance Criteria

- [ ] 滚动会话详情时，rail 上当前所在批注节点持续高亮（无需点击）。
- [ ] 点击跳转的闪光高亮仍独立生效。
- [ ] 无新增 scroll listener / 无每帧 DOM 遍历。
- [ ] 新增 `nearestAnnotatedSeq` 纯函数单测通过。
