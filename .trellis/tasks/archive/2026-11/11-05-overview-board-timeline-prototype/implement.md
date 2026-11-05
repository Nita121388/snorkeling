# 执行计划（D：甘特原型）

1. [x] `design/prototypes/overview-board-v2/timeline-gantt.html`：G1/G2 切换 + 四档时间窗 + hover + 倒序
2. [x] `design/prototypes/overview-board-v2/README.md`
3. [x] `design/plans/overview-board-timeline.md`：数据契约 / segments 纯函数 / 组件落点 / 验证设计 / 风险 / 推荐路径
4. [x] Trellis 记录 + 提交（不写实现代码）

## 后续实现任务要做的（不在本任务）

- `overview-timeline.tsx` + `overview-timeline-model.ts`（纯函数可单测）
- `overviewTimelineRangeAtom`（8h 默认，atomWithStorage）
- `OverviewViewModesImplemented` 加 `"timeline"` + 渲染分支
- 新验证 area `scripts/verify/overview-timeline/`（照 `_template`）
- （G2 才需要）agent-status 环形历史 + `buildTimelineSegments` 单测
