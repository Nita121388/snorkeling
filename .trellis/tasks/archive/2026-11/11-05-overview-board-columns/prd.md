# 多列看板（B）

> 父任务：`11-05-overview-board-v2`；技术设计见父任务 `design.md` §2.5。

## Goal

看板在任意面板宽度下都是「横向多列」，不是「纵向状态分组列表」。

## Requirements

- R1 5 列常显：`groupBlocksByStatus(..., { includeEmpty: true })`；空列渲染占位文案（"暂无"），
  列头始终有状态色点 + 中文标题 + 计数。
- R2 横向布局：`grid-auto-flow: column` + `grid-auto-columns: minmax(220px, 1fr)` +
  `overflow-x: auto` + `scroll-snap-type: x proximity`；列 `scroll-snap-align: start`。
  删除 `@container (min-width: 1160px)` 才多列的旧分支。
- R3 列内滚动保留：`.session-overview-board-cards` 仍 `overflow-y: auto`，横向滚动条只在 board 一层。
- R4 卡片状态点移除（状态由 chip 表达），列头色点独立类名 `.session-overview-board-column-dot`。
- R5 无障碍：列 `aria-label` 带标题与数量；空列占位有 `aria-hidden` 或文案即可。

## Acceptance Criteria

- [ ] 看板常显 5 列（含空列），列头有计数
- [ ] 任意宽度下列 top 一致（单行）；窄宽 `board.scrollWidth > board.clientWidth` 且 `scroll-snap-type` 含 `x`
- [ ] 宽屏 6 列同排可见（无纵向堆叠）
- [ ] 列表视图零回归

## 非目标

- 不改视图枚举 / 不加分组下拉 / 不做 Gantt（C、D 批次）。
