# 统一下拉框：共享 Select 组件（第一批：OverView 看板分组 + 时间线范围）

> 背景：用户 2026-11-18 反馈「OverView 看板分组的下拉框样式不好看」，补充「主要是 Windows 的不好看」
> 「问题就是展开态样式不好看」。审计结论：全项目 17 处原生 `<select>` + 1 处自绘 `VendorSelect`，
> 0 个共享组件；原生展开面板在 Windows 上走系统 UA chrome，不受主题令牌控制。
> 现有 `agenthooksettingsmodal.tsx:74` 的 `VendorSelect` 证明了 floating-ui 弹层可行，
> 但它是 modal 内一次性实现，缺 listbox 语义/方向键/焦点回归/尺寸变体。

## Goal

1. 落地一个可复用的下拉组件 `frontend/app/element/select.tsx`，外观与交互不依赖平台原生弹层；
2. 第一批只迁移用户直接看到的两处：看板分组、时间线范围；
3. 迁移后验证台（`scripts/verify/overview-board`、`overview-timeline`）判据不变且仍为绿。

## Requirements

- **R1 组件 API**：受控 `value` + `onChange(value)`；`options: {value,label,disabled?}[]`；
  尺寸变体 `xs | sm | md`（20 / 26 / 32px）；`variant: "default" | "bare"`（`bare` 用于宿主外壳自带边框/图标的场景）；
  `disabled`、`title`、`aria-label`、`className`；其余 `data-*` 透传到原生值通道。
- **R2 自绘弹层**：`FloatingPortal` 挂 body，`strategy: fixed`；底色/边框/圆角/阴影/选中态全部取主题令牌；
  `max-height` + 滚动；层级用 `--zindex-typeahead-modal`；宽度至少不窄于触发器。
- **R3 键盘与语义**：`ArrowDown/ArrowUp` 移动活动项（`Home/End` 到首末），`Enter` 提交，`Esc` 关闭，
  首字母跳转；关闭后焦点回触发器。触发器 `role="combobox"` + `aria-expanded` / `aria-controls` / `aria-activedescendant`；
  弹层 `role="listbox"`；选项 `role="option"` + `aria-selected`。选中项除颜色外必须有勾选图标（设计系统禁纯色义）。
- **R4 原生值通道（兼容层）**：组件内渲染一个视觉隐藏、`tabIndex={-1}`、`aria-hidden` 的原生 `<select>`，
  承载 `value` / `options` / `onChange` / `data-*`。目的：`verify.mjs` 里
  `sel.value = x; dispatchEvent(new Event("change"))` 与「CDP 可直接设值」的既有契约不破。
- **R5 迁移两处**：`frontend/app/session-overview/session-overview.tsx:2742`（`data-overview-range`）与
  `:2797`（`data-overview-group`）。保持：图标、26px 高度、`overviewBoardGroupAtom` / `overviewTimelineRangeAtom`
  持久化行为、选项值域与顺序、「切分组必须重跑布局」的既有语义。
- **R6 不硬编码颜色**：两套主题（dark / light / monochrome）下均取令牌；不允许 `#fff` 类字面量。

## 非目标

- 不改第 2、3 批调用点（VCS、aiaudit、waveconfig、三个 modal、property-list、codeblock-lang-select）。
- 不改 `typeaheadmodal` / `suggestion` / 命令面板（带搜索的浮层，语义不同）。
- 不引入新的第三方依赖（复用已在仓内的 `@floating-ui/react@0.27.19`）。

## Acceptance Criteria（必须机器可判）

| # | 判据 | 命令 → 期望 |
|---|---|---|
| A1 | 组件单测全绿（键盘/aria/值通道/尺寸变体） | `npx vitest run frontend/app/element/select.test.tsx` → exit 0 且 ≥10 通过 |
| A2 | 看板验证台保持绿 | `node scripts/verify/index.mjs --area overview-board` → exit 0 |
| A3 | 时间线验证台保持绿 | `node scripts/verify/index.mjs --area overview-timeline` → exit 0 |
| A4 | 仍可机器设值（兼容层生效） | 验证台内 `[data-overview-group]` 的 `tagName === "SELECT"` 且 `sel.value/[...sel.options]` 可用 → A2/A3 覆盖 |
| A5 | 类型与 lint 干净 | `tsc --noEmit` 改动文件 0 error；`npx eslint <改动文件>` 0 error |
| A6 | Windows 深色主题下弹层取令牌色 | 截图取弹层像素，邻近 `--modal-bg-color`/`--block-bg-color` 深色值（非白），记录色值 |

## 风险

- **验证台脚本依赖原生 select**：由 R4 兼容层吸收；若 A2/A3 失败，回滚到只改 SCSS（补 caret + 尺寸），
  并把「自绘弹层」降级为后续任务。
- **滚动容器内浮层定位**：`strategy: fixed` + `FloatingPortal`，避免 transform 祖先导致错位。
- **面板横滑（`.session-overview-board` 是 snap 横向滚动）**：触发器在 header，不在滚动容器内，风险低；
  仍需 A2 截图确认弹层未被裁剪。
