# CommonText 弹窗 UI 打磨

> 目标文件：`frontend/app/commontext/commontext-compose-modal.tsx`（及其配套 `commontext-editor-size.ts` / `commontext.json` i18n / 单测）
> 关联：父 11-07-commontext-cloud-sync（R3 前端筛选/详情已落地）；本包是弹窗视觉与交互的收尾打磨。

## Goal

对 CommonText 撰写弹窗（Compose Modal）做 6 点 UI 打磨：去掉过期提示文案、点击顶部编辑器缓慢展开、美化列表顶部筛选（含按机器筛选）、去掉行悬浮插入 icon、详情底部同步状态视觉修正、诊断并修复"弹窗偶尔无法聚焦点击需切 Tab"的 bug。

## Requirements

### R1 去掉副标题提示文案

- 移除 header 里 `t("commontext:compose.subtitle")` 的整行渲染（`commontext-compose-modal.tsx:1786`）。
- `commontext.json`（zh/en 等 locales）保留 key 不删（避免 i18n key 漂移导致 CI 报错），仅 UI 不再展示；如仓库有 i18n 使用检查则同步移除 key。

### R2 点击顶部 Editor 缓慢展开编辑区（动效）

- 现状：聚焦编辑器已 `setEditorExpanded(true)`（`:1856`），但高度切换是 `maxHeight` ↔ `height:36px` 的瞬时跳变（`transition-[min-height]` 不作用于这条路径）。
- 要求：点击（或聚焦）顶部编辑器时，编辑区以**约 200–260ms ease** 过渡从单行撑开到目标高度（`editorMaxHeight`），不是瞬跳。
- 约束：保留"显式收起按钮（`editorManuallyCollapsed`）不被自动展开覆盖"的既有契约（DOM 回归锁 A）；收起方向同样带过渡；不抢 `onMouseDown` preventDefault 之外的行为，不破坏中文输入合成态。
- 优先用 CSS transition（对 `max-height`/`height` 显式给目标值）实现，避免 JS 逐帧动画引入重排噪声（本弹窗刚做过 perf 整改）。

### R3 美化列表顶部筛选样式 + 按机器筛选

- 现状：creator 筛选是分组按钮（`:1987`，样式尚可），电脑筛选是原生 `<select>`（`:2028`，仅当 `deviceSummaries.length > 1` 时渲染），两排视觉不统一，原生 select 不美。
- 要求：
  - 筛选行统一为"圆角 chip / 分段控件"语言：creator 三档 + 机器筛选同一排同高（22px），同一圆角与边框，选中态统一用 `bg-actionsoft text-accent`。
  - 机器筛选改成与整体一致的 chip/下拉：左侧 `fa-computer`/`fa-laptop` 图标 + 当前机器名 + 计数，激活非 `any` 时高亮；仍列出 `deviceSummaries` 全部机器（名 + 计数），保留 `data-commontext-device` 属性供验证台定位。
  - 筛选行整体在弹窗窄宽时不溢出（`min-w-0 truncate`），无横向滚动。
- 机器筛选**功能已存在**（`commonTextItemMatchesDevice` / `deviceFilter`），本包只做样式与可发现性整改，不改筛选语义。

### R4 列表项悬浮不再显示"插入聚焦位置"icon

- 移除 `CommonTextRow` 右侧 hover 淡入的插入按钮（`:268-282` 的 `item-insert-btn` 那段），并把 meta 右槽还原为始终显示"次数 + 更新时间"（去掉 `group-hover:opacity-0` 的淡出）。
- 行点击仍 = 选中条目进详情；插入动作只保留详情栏的「插入」按钮（`:2565` 附近）与快捷键通道，不丢功能。

### R5 详情底部同步状态视觉修正

- 位置：详情栏底部 meta 行（`:2578` 起，`data-commontext-detail-sync`）。
- 要求：
  - synced 用**点亮的云**：实心 `fa-cloud` + accent 色（`text-accent`），与 pending 的 `text-warn` + `fa-cloud-arrow-up` 形成明暗对比；不再用暗灰云。
  - icon 与文字**垂直居中**（当前 `leading-none` + `text-[10.5px]` 与 9px icon 基线错位，观感偏低）；meta 行所有子项统一 `items-center` + 明确行高，不再混用 leading。
  - 相对时间改紧凑格式：更新时间/最近使用用 `formatCommonTextFreshnessCompact`（`now / 5m / 1h / 3d`），`"1 小时前"` 显示为 `1h`；完整时间戳仍走 tooltip。

### R6 Bug 诊断：弹窗偶尔无法聚焦/点击，需切 Tab 再切回才恢复

- 症状：CommonText 弹窗打开后偶尔整体点不动/不聚焦，切走 Tab 再切回才恢复。
- 要求：
  1. 先**真机诊断**留证据：`node scripts/inspect-electron-ui.mjs state/screenshot/elements` 抓复现时的 DOM/z-index/activeElement/`document.hasFocus()`，定位是 (a) 残留的全屏点击拦截层（发送 popover / flyout / overlay 未卸载）、(b) `modal-wrapper` z-index 被覆盖、(c) Electron 窗口失焦后 `document.hasFocus()` false 导致首击被吞，还是 (d) block 点击冒泡抢焦点（`modal.tsx:128-132` 拦截失效场景）。
  2. 按诊断结论修最小根因，并在任务笔记记录证据（截图/元素快照）。
  3. 真机不可用（启动器故障，见 `commontext-compose-modal.dom.test.tsx` 注释）时：给出可复现的最小 DOM/jsdom 断言 + 根因分析，真机复跑记入 verify-ledger 待办。

## Acceptance Criteria（可机器判定）

- **AC1（R1）**：`data-commontext-*` DOM 断言——弹窗内不存在 `commontext:compose.subtitle` 文案。
- **AC2（R2）**：新增 jsdom 断言：点击（focus）收起态编辑器后，编辑器带展开过渡 class/`data-*` 标记且高度目标生效；显式收起按钮后再次点击编辑器**不会**自动弹开（既有回归锁 A 不破）。
- **AC3（R3）**：新增 jsdom 断言：creator 分段与机器 chip 同一排渲染；机器 chip 激活后 `data-commontext-device` 值变化且选中态 class 生效；窄容器无横向滚动（jsdom 无布局，退化为"元素存在 + 选中态"断言）。
- **AC4（R4）**：DOM 断言列表行内不再有 `item-insert-btn` / hover 插入按钮；meta 列"次数+时间"在 hover 态仍可见（无 `opacity-0`）。
- **AC5（R5）**：DOM 断言 synced 条目 `data-commontext-detail-sync="synced"` 容器内含 `fa-cloud` 且有 accent class；相对时间文本匹配 `^(now|\d+[smhd])$`。
- **AC6（回归）**：`npx vitest run frontend/app/commontext/commontext-compose-modal.test.ts frontend/app/commontext/commontext-compose-modal.dom.test.tsx frontend/app/commontext/commontext-compose-perf.test.tsx frontend/app/commontext/commontext-freshness.test.ts` 全绿；`node scripts/check-tsc-baseline.mjs` 错误数不高于基线。
- **AC7（R6）**：诊断证据（CDP 快照或最小复现）+ 根因修复在任务笔记记录；修复后弹窗打开即可聚焦点击（真机或 DOM 级验证其一，环境受限时记 verify-ledger 待办）。

## Out of Scope

- 机器筛选语义/后端 origin 字段变更（属 11-07-commontext-sync-metadata）。
- 列表排序与相关度评分逻辑（属 11-19-commontext-compose-perf）。
- 云同步传输/WebSocket 推送（属 11-07/11-16）。
- 新增第三方组件依赖。
