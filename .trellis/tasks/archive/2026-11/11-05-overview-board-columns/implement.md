# 执行计划（B：多列看板）

1. [ ] `overview-board.tsx`：分组传 `includeEmpty: true`；列头加 `.session-overview-board-column-dot`；
       空列渲染 `.session-overview-board-empty`（文案 "暂无"）。
2. [ ] `session-overview.scss`：board 改横向 snap 单行；删除 `@container (min-width: 1160px)` 堆叠分支；
       新增 `-column-dot` / `-empty` 样式；卡片 dot 样式移除。
3. [ ] `overview-board.test.ts`：补 `includeEmpty` 空列顺序/数量断言（若已覆盖则略）。
4. [ ] `scripts/verify/overview-board/verify.mjs`：按 design.md 「验证脚本改动」替换/新增断言。
5. [ ] 真机验证：`node scripts/verify/preview-edit/run.mjs --keep-open --expect=fixed` +
       `node scripts/verify/overview-board/verify.mjs --attach`，期望全绿。
6. [ ] 目视 `02-board`（窄）与 `02b-board-wide`（宽）截图，确认「像看板」。
7. [ ] 台账确认（脚本自动追加）+ commit（B 独立提交）。

## 完成判据

- 5 列常显、单行、窄宽可横向 snap；
- 真机断言全绿，截图人工过目通过；
- 列表视图断言零回归。

---

## 完成记录（2026-11-05）

- [x] 1 `includeEmpty: true`（5 列常显）+ 列头 `.session-overview-board-column-dot` + 空列「暂无」占位
- [x] 2 CSS：`grid-auto-flow: column` + `minmax(220px, 1fr)` + `overflow-x: auto` + `scroll-snap-type: x proximity`；
      删除 `@container (min-width: 1160px)` 纵向堆叠分支
- [x] 3 单测：`includeEmpty` 既有用例覆盖（空列顺序/数量）
- [x] 4 验证台改造：旧的 `board-columns-fixed-order`（1..5 列）/ `wide-board-multi-column`（container query 轨道数）
      换成 `board-columns-all-five` / `board-column-dots` / `board-empty-column-placeholder` /
      `narrow-board-horizontal-scroll` / `narrow-board-scroll-snap` / `board-single-row-flow`；
      并把脚本接入 `lib/report.mjs` 的 `appendLedgerRow`（此前 overview-board 从不入台账）
- [x] 5 真机 28/28（连跑两次稳定），窄 269px：scrollWidth 1148 > clientWidth 269，snap=x；宽 1400px：5 列同排
- [x] 6 截图人工过目：窄面板是「列头 + 横滑」，宽面板 5 列并排
