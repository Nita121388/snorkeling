# 技术设计：`element/select.tsx` 共享下拉组件（第一批迁移）

## 0. 形态决策：两层 DOM

```
<span class="app-select is-open is-sm variant-bare" data-select-root>
  ├─ <select class="app-select-proxy" tabindex="-1" aria-hidden="true"
  │         data-overview-group …>        ← 值通道：.value / .options / change，验证台与 CDP 设值契约
  └─ <button type="button" role="combobox" aria-expanded aria-haspopup="listbox"
             aria-controls aria-activedescendant data-select-trigger>   ← 可见触发器
        {icon?} label <i class="fa-chevron-down" data-select-caret/>
</span>
└─(开) FloatingPortal → body
   <div role="listbox" class="app-select-menu" style={fixed 定位}>
     <div role="option" aria-selected data-select-option data-value="…">
        label <i class="fa-check"/> (selected 时)
```

为什么保留隐藏原生 `<select>`（而不是更新 3 个 verify 脚本）：

- `scripts/verify/overview-board/verify.mjs` / `overview-timeline/verify.mjs` 三处用
  `sel.value = x; sel.dispatchEvent(new Event("change"))` 驱动、`[...sel.options].map(o=>o.value)` 探测；
- 归档任务 `11-05-overview-board-view-switch/design.md` 明确把「CDP 可直接设值」当作设计契约；
- 兼容层让本任务边界 = 2 个调用点 + 1 个新组件，不碰验证脚本；
- 代价：一个 `aria-hidden` + `tabindex=-1` + `pointer-events:none` 的惰性元素，不进焦点环、不进读屏树。

## 1. API

```ts
type AppSelectOption = { value: string; label: string; disabled?: boolean };
type AppSelectSize = "xs" | "sm" | "md";           // 20 / 26 / 32px，字号 10 / 11 / 12px
type AppSelectProps = {
    options: AppSelectOption[];
    value: string;
    onChange: (value: string) => void;
    size?: AppSelectSize;                           // 默认 "sm"
    variant?: "default" | "bare";                   // bare：无框无底色无内边距，宿主外壳负责
    disabled?: boolean;
    title?: string;                                 // 触发器 tooltip
    ariaLabel?: string;                             // 触发器 aria-label（兼 proxy 的 aria-label）
    className?: string;                             // 追加到 data-select-root
    icon?: ReactNode;                               // 触发器文字前的图标（bare 场景由宿主给，组件不收）→ 不收，宿主自己放
    children?: never;                               // 不支持，选项只走 options
} & Record<`data-${string}`, string>;               // 全部透传到 proxy select
```

迁移点（`session-overview.tsx`）保持外壳不变：`<label class="session-overview-group-picker">`
里的 `<i>` 图标保留，`<select>` 换成 `<AppSelect variant="bare">`；`data-overview-group` / `data-overview-range`
进 proxy，`overviewBoardGroupAtom` / `overviewTimelineRangeAtom` 的 set 逻辑进 `onChange`。SCSS 里
`.session-overview-group-select` 改为作用于 proxy（视觉上仍隐藏，类名留给存量脚本兼容）。

## 2. 状态与交互

| 信号 | 行 |
|---|---|
| 触发器 click / Enter / Space | `useClick` 开 |
| 触发器 ArrowDown / ArrowUp（关） | 开 + activeIndex = 当前选中项（无选中则首项） |
| 弹层内 Arrow / Home / End | `useListNavigation({loop:true, focusItemOnOpen:false})` 移动 activeIndex |
| 输入字符 | `useTypeahead` 按 label 首字母匹配，命中即 setActiveIndex |
| Enter（开） | 提交 activeIndex → `onChange` → 关 → 焦点回触发器 |
| option click | 同上 |
| Esc / 外点 | `useDismiss`；焦点回触发器由 `FloatingFocusManager` 的 `returnFocus` 保证 |

定位：`useFloating({ placement: "bottom-start", strategy: "fixed", middleware: [offset(2), flip({padding:8}), shift({padding:8}), size({apply: minWidth = 参考宽})] })`，
`strategy: "fixed"` 规避 transform 祖先（看板横滑容器）导致 `absolute` 错位。

弹层焦点：`<FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>`——
焦点留在触发器（combobox 模式），靠 `aria-activedescendant` 报活动项。

## 3. 语义

- 触发器：`role="combobox"` + `aria-haspopup="listbox"` + `aria-expanded` + `aria-controls={menuId}` + `aria-activedescendant={activeOptionId}`；
- 弹层：`role="listbox"`，`aria-labelledby` 指触发器 id（`useRole(context, {role: "listbox"})` 会带出大部分）；
- 选项：`role="option"` + `aria-selected` + `aria-disabled`；id 用 `useId()` 前缀 + index（`aria-activedescendant` 依赖）；
- 选中视觉：左「✓」图标（`fa-check`）+ `--action-soft-*` 三件套（设计系统：禁纯色义）。

`aria-activedescendant` 与 `useListNavigation` 的联动是唯一易错点：`listRef` 必须与
`aria-activedescendant` 指向的 DOM 同一批节点，activeIndex 为 `null` 时清空属性。单测锁死。

## 4. 样式（`select.scss`，全部令牌）

| 层 | 取值 |
|---|---|
| 触发器 default | `h-{size}`、`border 1px var(--border-color)`、`radius 6px`、`bg var(--main-bg-color)`、hover `--hover-bg-color`、focus-visible `outline 2px var(--accent-color)` |
| 触发器 bare | 无边框无底色无 padding；caret 用 `currentcolor`（`mask` 或 fa 图标） |
| 弹层 | `bg var(--modal-bg-color)`、`border 1px var(--border-color)`、`radius 6px`、`box-shadow var(--shadow-color) 系`、`z-index var(--zindex-typeahead-modal)`、`padding 3px`、`max-height 264px; overflow-y auto` |
| 选项行 | `height 24px`、`radius 4px`、hover `--hover-bg-color`、active/selected `--action-soft-bg-color/-text-color/-border-color` |
| proxy | `position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; overflow:hidden` |

已知跟进（不在本批）：`.modal-wrapper` z-index 500 > `--zindex-typeahead-modal:100`，第三批迁 modal
内场景时弹层 z 得换 1000 一档（`SplitButton` 已用 1000 的先例）。

## 5. 测试设计

`select.test.tsx`（jsdom + createRoot + act，照 `splitbutton.dom.test.tsx` 惯例，不用 testing-library）：

1. 关态：trigger `role=combobox`、`aria-expanded=false`、caret 存在；proxy 是 `<select>` 且 `.value`/`.options` 反映 props。
2. 开态：trigger `aria-expanded=true`、menu `role=listbox`、选项 `role=option` 且恰一个 `aria-selected=true`、菜单 `min-width ≥` 触发器宽。
3. 键盘：ArrowDown 开 + active 移动（`aria-activedescendant` 跟随）；Enter 提交 → onChange 收到值 + 关 + 焦点回 trigger；Esc 关 + 焦点回 trigger；Home/End 首末。
4. 首字母：`useTypeahead` 命中 activeIndex。
5. 外点（pointerdown on body）关。
6. proxy 值通道：`sel.value = "x"; sel.dispatchEvent(new Event("change"))` → onChange 收到 `"x"`（锁定验证台契约）。
7. bare variant：trigger 无 border/bg 类；size 变体高度 20/26/32。

## 6. 回滚

组件为纯新增 + 两个调用点替换，`git revert` 单提交即可整体回退；回退后回到原生 select，验证台本就绿。
