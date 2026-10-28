# aisessions 批注时间线：性能优化

## Goal

审查并优化左侧批注时间线（AnnotationRail）渲染路径的冗余开销。

## Requirements

- `buildSeqRanks` 在每次 render 都执行且内部 `.map().sort()` O(n log n)；clusters 本来就按 seq 有序，rank 即 index。改为 O(n) 或直接使用下标。
- `annotationPreviewBySeq` 在 `detailMessages` 每次变化（流式 delta 每帧）时重建整张 seq→text(240) Map；改为只对含批注的 seq 切片。
- `AnnotationRail` body 的 `onScroll → setBodyScrollTop` 未走 RAF 合并；复用 `createRafCoalescer`。
- 时间分布相关的 position 计算必须放 `useMemo`，不随每帧重算。

## Acceptance Criteria

- [ ] `buildSeqRanks` 不再做排序（或删除），`timeline-virtual.test.ts` / `annotation-model.test.ts` 通过。
- [ ] `annotationPreviewBySeq` 只处理被批注引用的 seq；流式期间不再对整个会话做文本切片。
- [ ] rail 内部滚动 setState 一帧最多一次。
- [ ] 无新增 scroll listener 到消息列表。
