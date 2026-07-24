# UI 字号缩放与主色可设

## 背景

当前两个不可调和的痛点已暴露：

1. **浅色主题字号偏小**: 在 `frontend/app/theme.scss` 的 `[data-theme="light"]` 段临时挂了一组 token scale 覆盖 (`--text-xs` 等大一档, 默认 `font-weight: 500`), 让浅色下所有走 `text-xs/sm/base/lg/xxs/title/default` 的 utility 自动大一档 + 微加粗。这是**写死在主题里**的临时方案。
2. **字体 (UI 字号、Terminal 字号) 与主色 (accent) 应交给用户设置**, 不应由主题文件硬编码, 也不应只对浅色生效。

用户决策 (2026-07):

- **当前临时 token scale 暂不撤回**: 先保留浅色 token scale 兜底, 不让浅色回到过小字号。
- **正式方向**: 字号与主色都应做成用户可设, 主题文件不再硬编码字号缩放/字重/主色。
- **本轮不动主色 accent**: 主色可设是后续单独任务, 不在本 PR 范围。

## 目标 (后续 PR 推进)

### A. UI 字号缩放 setting

新 setting key: `ui:fontscale` (或 `ui:fontsize`), 类型 number, 候选 `0.9 / 1.0 / 1.1 / 1.2 / 1.25`。

实现路线:

- 在 settings schema (`build/cliapp/settings.go` / `frontend/types/gotypes.d.ts`) 注册该 key, 配合 `add-config` skill。
- `frontend/app/theme.scss` 顶层 (`:root`) 定义 `--ui-fontscale: 1` 默认值; 让 `--zoomfactor` 之外新增一个 *仅字号* 维度, UI 几何 (按钮高度、间距) 不被它放大, 避免和 `--zoomfactor` (整体缩放) 混淆。
- 通过 settings 写入到根 DOM 的 CSS 变量; Tailwind v4 `--text-*` token 在 `:root` 层引用 `calc(<原始值> * var(--ui-fontscale))`, 这样所有 `text-xs/sm/base/...` utility 自动跟随用户设置。
- 字重: 同理可加 `ui:fontweight` (normal/medium), 在 `:root[data-fontweight="medium"] .font-normal { font-weight: 500 }` 之类作用域化覆盖 (utility `font-medium/semibold/bold` 不动, 保持设计 weight 对比); 当前临时方案在 light theme 写 `font-weight: 500` 应迁移到这套用户 setting 的作用域上。
- 设置面板: Wave Settings 里加一节, 提供 5 档缩放 + 字重切换。
- 上线后: 从 `theme.scss` 浅色段删除临时 `--text-*` 覆盖与 `font-weight: 500` 默认, 改由用户 setting 驱动。

### B. Terminal 字号

Terminal 字号已有 settings key `term:fontsize` (默认 12, 右键菜单 6-18px 可选, `frontend/app/view/term/term-model.ts:361-369, 1436-1441`)。**不需要新机制**, 仅用户感知问题:

- 当前临时浅色 token scale 不影响 Terminal (Terminal 字号走 number 设置, 不读 `--text-*`)。
- 是否把默认 12 → 13 让"未主动设置过"的用户大一档 — 用户已质疑"会和右键设置冲突"。
- 决策: 不在浅色默认替换右键设置。若要让未配置用户大一档, 应改 `term-model.ts:369` 默认 fallback 值 12 → 13 (深浅色一致, 不踩右键逻辑; 用户主动选过的值不变)。
- 该改动**独立决定**, 与 UI 字号机制解耦。

### C. 主色 accent 可设 (后续任务, 本轮不动)

新 setting key: `ui:accent` (或复用 `theme:accent`), 类型 string color or named choice。

实现路线 (后续):

- `theme.scss` 各主题段的 `--accent-color` / `--accent-color-100..900` 改成从 setting 派生 (e.g. HSL transform of 单一 base hue) 或预设几套, 由 setting 切换。
- 设置面板加 "Accent color" 行, 调色板预设 (紫/绿/蓝/橙 等) + 自定义。
- 与现有浅色 `#a76fca` / 深色 accent 不冲突: 用户未设 = 默认值 = 当前值。

## 当前临时方案

`frontend/app/theme.scss` 在 `[data-theme="light"]` 段尾追加:

```scss
--text-xxs: 0.6875rem; // 10 → 11px
--text-xs: 0.8125rem; // 12 → 13px
--text-sm: 0.9375rem; // 14 → 15px
--text-default: 0.9375rem;
--text-base: 1.0625rem; // 16 → 17px
--text-lg: 1.1875rem; // 18 → 19px
--text-title: 1.1875rem;
font-weight: 500;

[data-theme="light"] .font-normal { font-weight: 500; }
```

仅浅色生效; 深色/monochrome 不受影响。**为过渡方案**, 上线 user-facing setting 后删除。

## 验收 (后续 PR)

- Settings 改字号缩放, UI 文字实时跟随, UI 几何 (按钮高度、tab 宽度) 不被放大。
- Terminal 占用 `term:fontsize` 自管, 与 UI 缩放正交。
- 主色 setting 切换, accent 色 (按钮、链接、starred chip 等) 实时变; 不切主题。
- 切回默认值 = 回到当前 UI 表现。

## 相关文件

- `frontend/app/theme.scss` (临时 token scale 所在, 后续删除)
- `frontend/tailwindsetup.css` (`@theme` `--text-*` 默认值所在)
- `frontend/app/view/term/term-model.ts` (`term:fontsize` setting 接入)
- `frontend/types/gotypes.d.ts` (settings key 生成目标)
- `build/cliapp/settings.go` (settings key 源, 配合 `task generate`)
