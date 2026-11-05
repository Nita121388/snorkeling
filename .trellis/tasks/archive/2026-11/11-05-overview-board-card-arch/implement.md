# 执行计划（A：卡片信息架构）

1. [ ] 新建 `agent-status-chip.tsx`，搬出 `AgentStatusChip` / `statusDurationText` / `shouldShowAgentStatusChip`；
       `session-overview.tsx` 删除原实现并 import —— 跑 `npx vitest run frontend/app/session-overview/` 确认零回归。
2. [ ] `overview-board-model.ts`：加 `OverviewBoardAvatar` / `OverviewBoardCard` 类型与
       `resolveBoardCardTitle` / `providerDisplayLabel` / `projectNameFromPath` / `formatBoardAge`。
3. [ ] `overview-board.test.ts`：补齐 4 个纯函数用例（分支覆盖 + 空值兜底）。
4. [ ] `session-overview.tsx`：`blockTitle()` 补 cwd basename；panel 组装 cards；`OverviewBoard` props 换 cards。
5. [ ] `overview-board.tsx`：`BoardCard` 重写（avatar / title / age / status chip / provider+project / preview / note）；
       移除旧 `formatBoardAge` / `truncatePreview` 组内副本，改用 model 版本。
6. [ ] `session-overview.scss`：卡片新结构样式；`preview` 单行 clamp；`note` 行 muted 小字。
7. [ ] 验证：`npx vitest run frontend/app/session-overview/`，`npx tsc --noEmit -p tsconfig.json | grep -c error TS` = 69。
8. [ ] commit（A 独立提交）。

## 完成判据

- 单测全绿、tsc 基线不增；
- 卡片 DOM 含 `.session-overview-board-card-avatar` / `.session-overview-agent-status` / `.session-overview-board-card-note`（有 note 时）；
- 列表视图真机断言（`scripts/verify/overview-board`）仍全绿（在 B 完成后统一跑）。

---

## 完成记录（2026-11-05）

- [x] 1 抽 `agent-status-chip.tsx`（+ `formatCompactDuration` 提到 `util/util.ts`，消掉 3 份时长格式化）
- [x] 2 `overview-board-model.ts`：`OverviewBoardCard` / `OverviewBoardAvatar` + `resolveBoardCardTitle` /
      `providerDisplayLabel` / `projectNameFromPath` / `formatBoardAge` / `truncateBoardPreview`
- [x] 3 `overview-board.test.ts`：新增 20 条纯函数用例（总计 33 条在本文件）
- [x] 4 `session-overview.tsx`：`blockTitle()` 补 cwd basename；panel 组装 cards；`OverviewBoard` 换 props
- [x] 5 `overview-board.tsx`：卡片重写（avatar / title / age / 状态 chip / provider+项目 / 预览 / note）
- [x] 6 `session-overview.scss`：卡片新结构（头像定宽 13px、预览 2 行 clamp、note 单行）
- [x] 7 单测 `npx vitest run frontend/app/session-overview/` 99 passed；tsc 基线 69 未增
- [x] 8 真机：`overview-board` 28/28（含播种 agent 块：emoji 🦊 头像 / 标题 `verify-board-agent` / chip `Thinking`）

踩坑记录：
- 卡片容器不能再用 `<button>`（内部状态 chip 是 button，嵌套按钮非法）→ 改 `div role="button"` + Enter/Space。
- 写 `localStorage` 的 persona 不会通知已初始化的 store（同文档没有 storage 事件）→ 验证台必须调
  `setAgentPersona()`，否则 emoji 断言永远是 logo。
