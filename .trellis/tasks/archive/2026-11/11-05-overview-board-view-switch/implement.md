# 执行计划（C：视图切换 + 看板分组）

1. [ ] `overview-board-model.ts`：视图枚举扩成三值（validator 只放已实现）+ `OverviewBoardGroup` 与
       `overviewBoardGroupAtom`（atomWithStorage，key `snorkeling.overview.boardGroup`）
2. [ ] `overview-board-model.ts`：列模型 `OverviewBoardColumnModel` + 三个分组纯函数 + 分发器
3. [ ] `overview-board.test.ts`：tab 顺序 / provider 排序与「非 Agent」/ 分发器 / 分组持久化读写与回落
4. [ ] `overview-board.tsx`：props 从 `includeEmpty` 改为 `group`，列头 tone 按分组决定（tab/provider 无色点）
5. [ ] `session-overview.tsx`：header 分段切换器 + 分组 `<select>`；`toggleViewMode` 换成 `setViewMode(mode)`
6. [ ] `session-overview.scss`：`.session-overview-view-switch` / `.session-overview-view-switch-button` /
       `.session-overview-group-select`
7. [ ] `scripts/verify/overview-board/verify.mjs`：选择器改 `[data-overview-view]`，新增 5 条分组断言
8. [ ] 验证：`npx vitest run frontend/app/session-overview/`、tsc 基线 69、
       `node scripts/verify/overview-board/verify.mjs`（期望 ≥33/33）、截图人工过目
9. [ ] 提交 + 归档 + 回写 spec/开发记录

## 门

- 每步跑 vitest；tsc 新增 error 即停。
- 真机若出现「切换分组后列高塌陷 / 横向 snap 失效」→ 先修 CSS，不带着问题过门。

## 与 D 的接口

- `OverviewViewMode` 已经是三值，D 只需把 `timeline` 加进 `OverviewViewModesImplemented` 并渲染一个 `<OverviewTimeline>`，
  不需要迁移 storage、不需要再动 header 结构。

---

## 完成记录（2026-11-05）

全绿一次过，未触发门里的返工。

- [x] 1 `OverviewViewMode` 扩成 `list|board|timeline`，`OverviewViewModesImplemented = ["list","board"]`
      （validator 只放行已实现值：未来版本写进来的 timeline 在旧版本回落 list，不白屏）
- [x] 2 持久化抽成 `createPersistedEnum()` 工厂，viewMode 与 boardGroup 共用一套读写/回落/跨窗口订阅
      （消掉 60 行复制样板）；新增 `overviewBoardGroupAtom` + key `snorkeling.overview.boardGroup`
- [x] 3 分组纯函数：`groupOverviewCardsByStatus` / `ByTab` / `ByProvider` + 分发器 `groupOverviewCards`；
      统一列模型 `{ key, title, tone?, blocks }`；provider 分组「非 Agent」列恒排最后
- [x] 4 `OverviewBoard` props `includeEmpty` → `group`，列头色点只在 status 分组渲染
- [x] 5 header 分段切换器（`[data-overview-view]`）+ 分组 `<select>`（`[data-overview-group]`），
      看板按钮保留 `.session-overview-view-toggle` 类名做脚本兼容
- [x] 6 单测 +11 条（tab 顺序 / provider 排序与兜底 / 分发器 / 分组持久化 / timeline 预留值）→ 110 passed
- [x] 7 真机 38/38（连跑两次）：分段切换、分组下拉、tab 分组无空列无色点、provider 分组含 Claude、
      分组持久化过 reload、既有 28 条零回归

与计划的偏差：`OverviewViewModesImplemented` 用 as const 数组而不是枚举常量对象（与既有 `OverviewBoardStatuses` 风格一致）。
