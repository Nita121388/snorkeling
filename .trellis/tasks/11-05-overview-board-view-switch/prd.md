# Overview 看板 C：视图切换与看板分组

> 承接 `11-05-overview-board-v2`（A 卡片信息架构 + B 多列看板已发）。用户 2026-11-05 确认：
> 「按照你推荐的来，先做 C 视图切换，然后再出 D 的甘特图原型」。
> 推荐形态 = **视图：列表 / 看板（+ 时间线由 D 接入）**，看板内再选**分组：状态 / Tab / Provider**，
> 而不是原型里 4 个平铺 tab。

## Goal

1. 视图切换从「一个 list↔board 图标按钮」升级成**可扩展的分段切换器**，D 接入 timeline 时不改结构；
2. 看板支持**三种分组**：按状态（现状）/ 按 Tab（泳道）/ 按 provider，并持久化选择；
3. 分组逻辑是纯函数，单测覆盖；真机断言覆盖「切换分组后列头/列数/排序」与持久化。

## Requirements

- R1 视图枚举：`OverviewViewMode = "list" | "board" | "timeline"`，但当前"已实现"集合只有 list/board；
  `isOverviewViewMode()` 只接受已实现值（未来版本写进来的 `timeline` 在旧版本降级为默认，不白屏）。
- R2 分段切换器：header 里 `[列表][看板]` 两枚按钮（D 追加第三枚），
  每个按钮 `data-overview-view="list|board"` + `aria-pressed`；当前模式高亮。
- R3 分组下拉：仅看板模式显示，`data-overview-group` 属性；选项 状态 / Tab / Provider；默认 状态。
- R4 分组纯函数：
  - status：沿用 `groupBlocksByStatus`（5 列固定顺序，`includeEmpty` 常显）
  - tab：按 Tab 分列，列序 = Tab 在 workspace 中的顺序；**不显示空列**
  - provider：按 provider 展示名分列，列序 = 卡片数降序 → 名称升序；无 provider 的卡归「非 Agent」；**不显示空列**
  - 列模型统一 `{ key, title, tone, blocks }`，供渲染层统一处理（状态色点只有 status 分组有）
- R5 持久化：分组选择写 localStorage `snorkeling.overview.boardGroup`，非法值回落 `status`；
  Tab 切换/重开不丢（与 view mode 同一套 atomWithStorage 模式）。
- R6 卡片与列计数、空列占位、横向 snap 行为在三种分组下一致（B 的成果不能只在 status 分组生效）。

## Acceptance Criteria

- [ ] header 有分段视图切换，两个按钮 `aria-pressed` 正确；点「看板」进看板、点「列表」回列表
- [ ] 看板模式下出现分组下拉；切到 Tab / Provider 后列头随之变化，且不再出现空列
- [ ] 分组选择刷新后保持；非法存储值回落为「状态」
- [ ] 状态分组仍为 5 列常显（B 的断言全绿）
- [ ] 纯函数单测：tab 分组顺序、provider 分组排序与「非 Agent」兜底、分组持久化读写
- [ ] 真机 `overview-board` 验证台扩展断言全绿（28 → 30+）

## 非目标

- 不实现 timeline 视图本身（D 出原型后再排）；
- 不改卡片信息架构（A 已定稿）；
- 不引入新的 provider→图标映射（provider 展示名沿用 `providerDisplayLabel`）。
