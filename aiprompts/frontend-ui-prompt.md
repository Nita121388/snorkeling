# 前端开发 Prompt — Snorkeling（WaveTerm fork）

> 面向 AI agent 的前端实现前置提示词。**本文件的每条"事实"都在仓库里核对过**，出处附在括注里；核对记录见 `frontend-ui-prompt.review.md`。
>
> 原则来源：@jakevin7「优先复用成熟库 / 组件源代码可控 / 统一设计语言 / 严格限制重复依赖」，@psiace「严禁在已有依赖可以正确表达的情况下自行设计实现组件和行为」，taste-skill v2 `references/app-screens.md`。
>
> 但论坛那套库（shadcn/ui Nova、Lucide、Motion、dnd-kit、Zustand）**在本仓库一个都不适用**，理由见 §2。

---

## 0. 适用边界

| 范围 | 是否适用 |
| --- | --- |
| root `frontend/`（Electron renderer，React 19） | ✅ 主要对象 |
| `emain/`（Electron 主进程） | 部分（仅 UI 相关约定） |
| `tsunami/frontend/`（独立 workspace，React 19 + jotai 2.13） | ❌ 独立技术栈，不跨用 atom / 依赖 / 样式 |
| `docs/` | ❌ |

**核心判断**：这个仓库不是"白纸新项目"，是一套**已成型的自研 UI 体系**（自建组件库 + Tailwind v4 语义 token + SCSS hybrid）。所以"优先复用成熟库"在这里的准确含义是——

> **先复用仓库里已有的实现；仓库没有的，才考虑依赖；依赖里也没有的，才自己写。**

论坛作者说的是"选好库让 AI 生成"，本仓库需要的是"**别让 AI 重新发明已有的东西**"。两者的正确姿势不同。

---

## 1. 第一原则：先查再写

写任何 UI 代码前必须做完这三步，并在回复里报告结论（命中什么 / 扩展什么 / 为什么必须新建）：

```bash
ls frontend/app/element                        # 1. 现有组件清单
rg -n "<能力关键词>" frontend/app               # 2. 同类实现
rg -n "pushModal|ContextMenuModel|useVirtualizer|ResizablePanel" frontend/app
```

### 铁律

- **R1** 现有组件覆盖 80% → 加 props/variant，不复制新组件。
- **R2** 已有依赖能正确表达 → 禁止手搓。手写下拉定位 / 拖拽 / 虚拟滚动 / 模态 / tooltip 都算违规。
- **R3** 上游 waveterm 已有实现 → 对齐上游形态。
- **R4** 不新增运行时依赖。确需新增：给体积、是否替换现有依赖、licence、Electron 兼容性，等确认。
- **R5** 不复制粘贴逻辑：常量、解码、类型守卫放数据 owner 旁边。
- **R6** 改共享符号前跑 GitNexus `impact({target, direction:"upstream"})`，HIGH/CRITICAL 先报告再动手。

### 反例（本仓库真实发生过的）

`frontend/app/view/waveconfig/waveaivisual.tsx` 手写了内联重命名输入框（`onBlur` + `onKeyDown` + `autoFocus`），而 `frontend/app/element/inline-rename-input.tsx` 已经实现了同样行为，还多做了 basename 选中和事件隔离。这就是 R1/R2 的典型违反。

---

## 2. 技术栈真相表

| 需求 | 本项目实际用法 | 禁止引入 |
| --- | --- | --- |
| 组件库 | `frontend/app/element/*`，每个组件 `xxx.tsx` + `xxx.scss` 成对 | shadcn 组件、Radix、MUI、AntD、Mantine |
| class 合并 | `cn`（`@/util/util`，clsx + twMerge） | `@/shadcn/lib/utils` 的 cn；裸 clsx |
| shadcn | **只 vendored 了一个 `cn`**，无组件目录 | 往里加 shadcn 代码 |
| 图标 | Font Awesome Sharp：`<i className="fa-sharp fa-solid fa-check" />`（`fa-sharp fa-solid` 194 处 vs `fa fa-solid` 30 处 vs `fa-solid` 裸写 93 处）；动态图标用 `makeIconClass()`（130 处） | lucide-react / heroicons / react-icons / emoji 当图标 |
| 动画 | Tailwind `transition-*` + SCSS `@keyframes` | motion / framer-motion / gsap / react-spring（**均未安装**） |
| 分栏 | `react-resizable-panels` v3（`workspace/workspace.tsx`） | 手写 mousemove |
| 拖拽 | `react-dnd` + `react-dnd-html5-backend` | dnd-kit / sortablejs / 原生 HTML5 drag |
| 状态 | `jotai`（root 锁 **2.9.3**）+ ViewModel 类 | zustand / redux / mobx / recoil |
| 虚拟滚动 | `@tanstack/react-virtual`（`treeview`、`aisessions/session-detail.tsx`） | 手写 windowing |
| 浮层定位 | `@floating-ui/react`，且已被 `element/popover.tsx`、`element/tooltip.tsx`、`element/flyoutmenu.tsx`、`element/menubutton.tsx` 封装 | 直接裸用 floating-ui；手写 `getBoundingClientRect` |
| 右键菜单 | `ContextMenuModel`（`@/app/store/contextmenu`） | 自造菜单 DOM |
| 模态 | `modalsModel.pushModal(name, props, onCancel)` + `modals/modalregistry.tsx` | `window.confirm` / `window.alert` |
| 滚动条 | 常规用 `overflow-y-auto`；只有已有 9 个文件用 `overlayscrollbars-react` | 为新面板专门引 OverlayScrollbars |
| 表格 | `@tanstack/react-table` **只在 preview 用过（2 个文件）**，不是通用方案 | ag-grid；为小列表上 react-table |
| 图表 | root `frontend/` **没有图表使用**（`recharts` 在 root deps 里但 `frontend/` 零引用；只在 `tsunami/frontend` 用） | 为设置页引入图表库 |
| 编辑器 | `monaco-editor` + `monaco-yaml`（11 个文件） | codemirror |
| Markdown | `react-markdown` 9 + remark/rehype + `shiki` + `streamdown` + `mermaid` | 自写 parser |
| 终端 | `@xterm/xterm` 6 + addon-fit/search/serialize/webgl | 其它终端实现 |
| 样式 | Tailwind v4（`frontend/tailwindsetup.css` 的 `@theme inline`）+ 既有 SCSS hybrid，新代码优先 Tailwind | CSS-in-JS / styled-components |
| 测试 | `vitest`，就近 `*.test.ts(x)` | jest / playwright 单测 |
| 输入节流 | `throttle-debounce`（9 个文件在用） | 自己 `setTimeout` 手搓 debounce |

> **不要**为了"版本统一"去改 root 的 jotai 锁版本，也不要跨 workspace 复用 atom。

---

## 3. 设计语言

### 3.1 主题链路与一个真实陷阱

```
theme.scss 定义 CSS 变量（三种主题：dark / light / monochrome）
  → tailwindsetup.css 的 @theme inline 映射 --color-*
  → 组件写 Tailwind 语义类
```

**陷阱：`@theme inline` 里的值如果是字面量，Tailwind 会直接编译成硬编码颜色，主题切换不了。** 只有值是 `var(--x)` 时才会跟随主题。

实测（`dist/frontend/assets/index-*.css`）：

```css
.bg-surface      { background-color: #ffffff0f; }        /* 字面量 → 恒为白色微透明 */
.bg-surface-soft { background-color: #ffffff0a; }        /* 同上 */
.bg-block        { background-color: var(--block-bg-color); }   /* 跟随主题 ✅ */
.bg-panel        { background-color: var(--panel-bg-color); }   /* 跟随主题 ✅ */
.bg-modalbg      { background-color: var(--modal-bg-color); }   /* 跟随主题 ✅ */
```

`bg-surface*` 全仓库用了 **99 处**，在深色主题下是正确的高光层，在浅色主题下变成"比背景更白的一层"，分层方向反了。`theme.scss` 里虽然定义了 `--color-surface: #f0ede6`（浅色），但 `bg-surface` 已经被内联成字面量，用不到它。

> 结论：**`bg-surface` / `bg-surface-soft` / `bg-surface-strong` 是本仓库唯一三个主题无关的背景 token。** 新代码用 `bg-panel` / `bg-block` / `bg-modalbg` / `bg-hover` / `bg-actionsoft`。

### 3.2 语义 token 表

| 用途 | class | 主题安全 |
| --- | --- | --- |
| 面板底 | `bg-panel` `bg-block` `bg-modalbg` `bg-background` | ✅ |
| 悬停 / 选中 | `hover:bg-hover` `hover:bg-hoverbg` `bg-highlightbg` | ✅ |
| 弱强调底 | `bg-actionsoft` (配 `text-actionsofttext` / `border-actionsoftborder`) | ✅ |
| 主强调按钮 | `bg-action text-actiontext hover:bg-actionhover` | ✅ |
| 文字 | `text-primary` `text-foreground` `text-secondary` `text-muted-foreground` `text-muted` | ✅ |
| 边框 | `border-border` | ✅ |
| 状态 | `text-success` `text-warning` `text-error` | ✅ |
| 品牌色 | `text-accent` `bg-accent` `border-accent`、`bg-accent/5` `bg-accent/10` | ✅（走 color-mix） |
| 半透明高光 | `bg-surface` `bg-surface-soft` `bg-surface-strong` | ❌ 硬编码白色 |

**类名不是 token 时会静默失效**：`text-main` 在仓库里被用了 10 处（`restartconfirmmodal.tsx`、`unsavedfilemodal.tsx`），但 `--color-main` 不存在，编译产物里没有 `.text-main` → 这些文字**只是继承了父级颜色，写不写一样的**。正确名字是 `text-primary` / `text-foreground`。写新类前先确认 token 存在。

### 3.3 字号、圆角、密度（仓库实测，不要自己发明）

| 项 | 实际用法 |
| --- | --- |
| 字号 | `text-xxs`(10px，官方 token) / `text-[9px]`(48 处) / `text-[10px]`(130 处) / `text-[11px]`(213 处) / `text-xs`(12) / `text-sm`(14) |
| | **不要新造"不低于 Npx"的规则**。阶梯本来就是 9–14px 密集布局，跟着相邻组件走。 |
| 圆角 | `rounded`(4) / `rounded-[3px]` / `rounded-sm` / `rounded-lg`(8，分组容器) |
| 间距 | 4px 网格；面板内 `p-4`/`p-5`，分组间 `gap-3`，字段间 `gap-1.5`–`gap-2` |
| 控件高 | `h-7`(28px，25 处) 与 `h-8`(32px，23 处) 并存。**同一界面内选一种，别混。** 输入框/触发器建议 `h-8`，行内小按钮 `h-7` |

### 3.4 颜色纪律

- 屏幕彩色像素 ≤ 5%，彩色只给**状态和数据**，不给装饰。
- 不给图标加彩色圆底；不给卡片加渐变 / 发光 / 玻璃态。
- 选中态优先中性底（`bg-hover` / `bg-hoverbg` / `bg-actionsoft`），不整行染品牌色。

### 3.5 表面与层级

- 默认平面：1px `border-border` 或一层 `bg-panel` 色阶差。
- 阴影只给真浮层（popover / modal / 拖拽中）。

### 3.6 类名冲突：`.block` 不是 Tailwind 的 `block`

`frontend/app/block/block.scss` 定义了一个**未分层**的全局类：

```scss
.block {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    overflow: hidden;
}
```

未分层 CSS 的优先级高于 Tailwind 的 `@layer utilities`，所以**在任何组件里写 `className="block"` 都会拿到上面的样式**，而不是 `display: block`。

实测后果：`<label className="mb-1 block text-xs">` 变成 `display: flex; justify-content: center; width: 100%` 的全宽居中容器，表单 label 全部居中、被撑满（`waveaivisual.tsx` 曾因此翻车）。

**规避**：需要块级元素时用 `w-full` + 显式布局，或直接不写 `block`（`<div>`/`<label>` 默认就是块级或行内，按需选择）。同理要小心 `.flex`、`.grid` 之外的自定义全局类名。

### 3.7 光标与可达性（`rules.md` + 测试契约双重约束）

- 可点击元素一律 `cursor-pointer`。
- **禁止 `cursor-help`**（`rules.md` 明确禁止）；禁用态用 `opacity-50` + `disabled`。
- 图标按钮必须有 `aria-label` 或 `title`。
- `frontend/app/element/foundation-control-states.test.ts` 会**测试** `button.scss`/`iconbutton.scss` 必须有 `outline: 2px solid var(--accent-color)`，`input.tsx`/`multilineinput.tsx`/`toggle.tsx` 必须有 `aria-invalid`。改这些文件的样式会**跑挂测试**。
- 键盘可达：`Tab` 顺序合理，`focus-visible` 有可见描边（`focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent`，`agenthooksettingsmodal.tsx` 是这个写法）。

### 3.8 动效

- 只做 ≤150ms 的颜色/透明度过渡：`transition-colors`。
- 面板进出用 SCSS keyframes（`modals/modal.scss` 的 `modalScaleIn`、`element/markdown.scss` 的 `markdown-flyout-in`）。
- 不做位移动画、逐项 stagger、hover 放大。

---

## 4. 代码规范（摘自 `.kilocode/rules/rules.md`，强制）

- 4 空格缩进；文件名全小写；**只用 named export**，无 default export。
- 跨目录 `@/...`（`@/app/*` `@/util/*` `@/element/*` `@/store/*` `@/view/*`）；同目录 `./`。
- 空值判断用 `== null` / `!= null`，不用 `=== undefined`。
- 优先 early return。
- `React.memo` 必须给 `displayName`。
- `useAtom` / `useAtomValue` 只在组件顶层，不内联进 JSX。
- 写 atom 用 `PrimitiveAtom<T>`；`atom(null)` 在 `strict:false` 下直接 cast，不加 `| null`。
- 类里不用 `private` 字段。
- 文件顶部全局常量 PascalCase。
- 不用 `atob`/`btoa`，用 `frontend/util/util.ts` 的 base64 helper。
- `isBlank` / `makeIconClass` / 自然排序优先复用 `@/util/util`。
- `tsconfig` 是 `strict: false`，别指望空值检查兜底。

---

## 5. App 屏幕审美规则

设置页、管理面板属于"人在里面干活的屏幕"，适用 taste-skill 的 `references/app-screens.md`，**不是**它首页那套 hero / 摄影 / 滚动剧本。

1. **先回答一个问题**。本屏幕要回答：*我在用哪个模型？它连得通吗？*
2. **没有 hero header**。标题 ≤ 20px，不堆"大标题 + 副标题 + 说明"三段。注意 `waveconfig.tsx` 外壳**已经有**页面标题和 JSON/Visual 切换，内容区不要再重复标题。
3. **颜色给数据**。默认标记、连通状态、错误原因才配用色。
4. **表面平**。1px 线或一层色阶，不用阴影。
5. **导航退后**。选中是中性底或文字变色，不是彩色竖条 + 彩色胶囊。
6. **列表 = 对齐 + 分隔线**。不要斑马纹、不要表头色带。
7. **状态诚实**。加载显示加载，空显示空，失败显示真实原因，不造假数据撑密度。
8. **空态要能做事**。给 1–2 个真实动作，不是一句 "No AI modes configured yet"。
9. **用行话**。Provider / API type / Endpoint / Secret / Model / Latency，不要 Items / Records / Status。
10. **密度要够**。1440 宽第一屏能看到列表 + 表单首字段。
11. **一致性**。同类控件同高同圆角；label 方案整屏只允许一种。

---

## 6. 本仓库缺失的基础设施（先别急着补，也别硬造）

这是"本项目缺什么可以用上"的正经答案。按"该不该现在补"分级：

| 缺什么 | 现状 | 建议 |
| --- | --- | --- |
| **通用 Confirm 弹窗** | 只有专用 `RestartConfirmModal`；其余地方用 `window.confirm` | ✅ **值得沉淀**。用 `FlexiModal` 写一个 `ConfirmModal`，参照 `restartconfirmmodal.tsx` 的 `resolvedRef` 防重复 resolve 模式 |
| **通用 Select / 下拉** | `element/` 里没有；`agenthooksettingsmodal.tsx` 手写了一个（`absolute z-[var(--zindex-typeahead-modal)]`）；另有 9 处原生 `<select>` | 优先用 `element/popover.tsx` 或 `element/flyoutmenu.tsx` 组合，**不要再手写第三个** |
| **Toast / 轻提示** | 无 | 用 `MessageModal` 或页面内联状态行；**不要为一次需求引入通知库** |
| **文本折叠（中段省略）** | `element/middle-ellipsis.tsx` 已有 `variant: "middle" \| "tail"` | 长路径 / 长模型名直接用它，别用 `truncate` 丢尾部 |
| **状态图标** | `element/refresh-status-icon.tsx` 已有 idle/syncing/stale/autoEnabled/error 五态 + tooltip | 连通/刷新状态复用，不要重画 |
| **复制按钮** | `element/copybutton.tsx` | 错误信息要可复制时直接用它 |
| **空态 / 加载占位** | `element/quickelems.tsx` 导出 `CenteredDiv` / `CenteredLoadingDiv` | 复用 |
| 表单校验 | 无 form 库 | 手写即可，别引入 react-hook-form |
| 组件文档 / Storybook | 无 | 不补。用测试文件当契约（`foundation-control-states.test.ts` 是范例） |

---

## 7. 自检闸门

```bash
# 0) 改共享符号前
#    GitNexus: impact({target:"SymbolName", direction:"upstream"})，HIGH/CRITICAL 先报告

# 1) 类型（注意：仓库有既有诊断，见下）
npx tsc --noEmit

# 2) lint（只查改动目录）
npx eslint frontend/app/view/waveconfig frontend/app/modals

# 3) 单测
npm test -- waveconfig
npm test -- element

# 4) 真机视觉验证——必做，不要靠"静态构建通过"结案
npm run dev:cdp
node scripts/inspect-electron-ui.mjs state
node scripts/inspect-electron-ui.mjs elements --limit 40
node scripts/inspect-electron-ui.mjs style "Wave AI Modes"
node scripts/inspect-electron-ui.mjs screenshot
```

**已知基线噪声**：`waveconfig-model.ts` 有既有的 `FileInfo.mimetype` 类型诊断，不是你的改动引入的。判断标准是"**没有新增诊断**"，不是"零诊断"。

CDP 必查：

- 面板 320 / 720 / 1200 三档宽度无横向溢出、无信息截断。
- **暗色 + 浅色两个主题各看一次**（浅色才能暴露 `bg-surface` 这类硬编码）。
- 列表项 / 输入框 / 按钮高度一致。
- 长 provider 名截断但有 `title`。

**完成后回复格式**：改动文件 → 复用了什么 → 新增了什么及理由 → 闸门结果 → 视觉证据（截图路径或 CDP 数值）。

---

## 8. 禁止清单

- 引入 lucide / framer-motion / dnd-kit / zustand / shadcn 组件 / 图表库。
- 手写下拉、tooltip、模态、右键菜单、虚拟滚动、分栏拖拽、debounce。
- `window.confirm` / `window.alert` / `prompt()`。
- 用 `bg-surface*` 做主题面板底。
- 猜 token 名（如 `text-main`）——不存在的类会静默失效。
- 渐变、glow、glassmorphism、彩色圆形图标底、卡片阴影雨。
- `cursor-help`；`<div onClick>`（用 `<button type="button">`）。
- 图标按钮没有 `aria-label` / `title`。
- emoji 当功能图标。
- 为一次性需求新增依赖。
- 复制已有组件改名当新组件。
- 改 `frontend/app/aipanel/waveai-model.tsx`、`waveai.json` 结构、`AIModeConfigType`、Go RPC（除非任务明确要求）。

---

## 9. 场景包：Settings → Wave AI Modes 美化

### 9.1 目标与边界

| 项 | 值 |
| --- | --- |
| 目标文件 | `frontend/app/view/waveconfig/waveaivisual.tsx` |
| 外壳（只读） | `waveconfig.tsx`、`waveconfig-model.ts` |
| 数据层 | `waveai-modes.ts`、`waveai-templates.ts` |
| 运行时消费者（禁改） | `frontend/app/aipanel/waveai-model.tsx` |
| 关联任务 | `10-13-wave-ai-model-settings`、`10-17-wave-ai-default-provider` |

### 9.2 现存问题（按代码锚点，不按行号——行号会漂）

| # | 问题 | 锚点 | 修法 |
| --- | --- | --- | --- |
| 1 | 主题无关底色 | 三处 `bg-surface`（添加面板 section、双栏容器、头像圆底） | `bg-panel` / `bg-block` / `bg-actionsoft` |
| 2 | 关键信息 9px | `text-[9px]` 的 "Default" 徽标 | 改 `text-xxs` + `bg-actionsoft text-actionsofttext rounded px-1` |
| 3 | 原生弹窗 | `window.confirm`（删除）、两处 `window.alert`（删除失败、读 cc-switch 失败） | 复用 `MessageModal` 报错；删除确认**新建 `ConfirmModal`**（现无通用 Confirm，见 §6） |
| 4 | 整页 reload | `window.location.reload()`（cc-switch 导入后） | 删掉。atom 会经 watcher 广播自动刷新；若无更新，修同步 bug 而不是 reload |
| 5 | 添加面板顶掉列表 | `<section>` 插在双栏容器上方 | 改成右栏顶部临时面板，或 `Popover` |
| 6 | 空 header | `<header>` 里只有一个右对齐按钮，左侧全空 | 左栏顶部工具栏：筛选输入 + `+` |
| 7 | 手写重命名 | 自建 input + onBlur/onKeyDown | 复用 `element/inline-rename-input.tsx`（R1 反例） |
| 8 | 连通状态与默认标记混用 | 列表项 6px 圆点表示 `isDefault`，不表示连通 | 拆成两个概念：默认徽标（弱底）+ 连通点（success/error/muted） |
| 9 | 控件高度不齐 | 按钮 `py-1 text-xs`（≈26px）vs 输入 `py-1.5`（≈30px） | 统一 `h-8`（输入/触发器）+ `h-7`（行内按钮） |
| 10 | 模型 chip 10px + `py-0.5` | 拉取模型结果按钮 | `text-[11px] font-mono` + `h-6` |
| 11 | 窄态列表高写死 | `max-h-[168px]` | 用 `min-h-0` + `flex-1`，靠容器查询控制方向 |
| 12 | 错误信息不可复制 | 测试连接 / 拉取模型的错误 `<p>` | `element/copybutton.tsx` |
| 13 | 无筛选 | 列表无搜索框 | `element/input.tsx` 的 `Input`（**不是** `element/search.tsx`，那是全屏查找栏） |

### 9.3 目标形态

```
┌──────────────────────────────────────────────────────────────────┐
│ [⌕ Filter models…]                              [+ Add provider] │ 工具栏 h-9
├────────────────────┬─────────────────────────────────────────────┤
│ ● My AI    默认    │ [◉] My AI · openai-chat      [Set default] [🗑] │
│ ○ OpenAI           │ ─────────────────────────────────────────── │
│ ○ Anthropic        │ API type  [Responses][Chat][Anthropic][Gemini]│
│                    │ Endpoint  [__________________________]        │
│ (if legacy exist)  │ Model     [gpt-5-mini    ] [Fetch models]    │
│ BUILT-IN           │ Secret    [OPENAI_KEY    ] [Test connection] │
│ ○ Quick            │           ✓ 214ms / ✗ 401 Unauthorized [⧉]   │
│ ○ Balanced         │ ─────────────────────────────────────────── │
│                    │ cc-switch  [Import providers…]               │
└────────────────────┴─────────────────────────────────────────────┘
```

- 左栏 240–260px，列表项 32px pitch（`h-8`）；状态点 6px + 名称 + 默认徽标。
- 分组小标题：`text-xxs font-medium uppercase tracking-wide text-muted-foreground`。
- 右栏 `max-w-[640px]`，label 上置（与 `Field` 现有写法一致），字段说明 `text-[11px] text-muted-foreground`。
- 状态色只三种：`text-success` / `text-error` / `text-warning`。
- 删除走新建的 `ConfirmModal`。

### 9.4 一个必须由用户裁决的点

`10-17` PRD 写着：「用户项归 `My Models`，内置项归 `Built-in Wave AI`，且内置项保持可选」。

但 commit `364a23ad`（*hide legacy built-in presets from provider list*）**故意**把内置分区删掉了，`b164f05b` 又只恢复了过滤函数、没恢复分区。当前代码**只渲染 `userEntries`**。

这是**产品决策冲突**，不是单纯"漏实现"。开工前必须确认：

- **A（保守，推荐）**：保持隐藏。内置 Quick/Balanced/Deep 仍是旧版遗留，新用户不该看到。
- **B（按 PRD）**：补 `Built-in Wave AI` 分组，限定"仅在配置里已存在时显示"，可折叠、只读或可复制。

**默认按 A 执行并在 PR 说明中标注**，除非用户要求 B。

### 9.5 验收

- [ ] 暗 / 浅主题均无分层错误，无 `bg-surface*`
- [ ] 320 / 720 / 1200 宽无横向滚动，长名截断有 `title` 或 `MiddleEllipsis`
- [ ] 控件高度统一（每屏一种）
- [ ] 测试连接四态（idle / testing / ok / error）视觉可区分，错误可复制
- [ ] 无 `window.confirm` / `window.alert` / `window.location.reload`
- [ ] 无新增依赖；重命名复用 `InlineRenameInput`
- [ ] `npx tsc --noEmit` 无**新增**诊断；`npx eslint` 通过；`npm test -- waveconfig` 通过
- [ ] waveai.json 结构与 `waveai-model.tsx` 零改动

---

## 10. 参考

### 10.1 taste-skill（已安装）

- 位置：`~/.pi/agent/skills/design-taste-frontend` → `~/.pi/agent/skills-src/taste-skill`（symlink，`git pull` 可更新）
- 只用：`references/app-screens.md`、`references/critique.md`、`lint.mjs`、`inspect.mjs --app`
- **不要**用它的首页流程（`draw.mjs` 默认 deal 营销页方向、摄影素材、滚动剧本），对桌面 App 屏幕是错的
- 它的 `inspect.mjs` 要 Chromium；本项目优先用 `scripts/inspect-electron-ui.mjs`

### 10.2 论坛原则 → 本项目正确形态

| 论坛说法 | 本项目的正确形式 |
| --- | --- |
| 优先复用成熟库 | 先复用 `frontend/app/element/*` 与 §2 已有依赖；仓库没有才考虑新库 |
| 组件源代码可控 | 只允许仓库内 vendored 的组件，不引运行时黑盒 UI 框架 |
| 统一设计语言 | 只用 §3.2 主题安全 token，暗/浅/单色三主题自动跟随 |
| 严格限制重复依赖 | 一个能力一个实现；不新增依赖；不跨 workspace 复用 |
| 指定好各种库 | §2 表（注意：论坛推荐的 5 个库在这里全不适用） |
| 严禁自行设计已有依赖能表达的组件 | R2 铁律 + §1 反例 |