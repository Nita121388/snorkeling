# 属性编辑器对齐 Wolai 交互 — 调研与改造方案

> 调研时间：2026-09-08
> 调研方式：bb-browser 实例 A（独立 Edge profile，端口 19825）实机操作
>   `https://www.wolai.com/kbNoLqLExrrGBEhjy5sYhc`（Vue-Vben-Admin，数据库表格视图，已登录）
> 证据分级：**[实测]** = 本人在浏览器里触发并 dump 到的 DOM/尺寸；**[推断]** = 由结构推导；**[待验证]** = 合成事件没能触发，需真实 CDP 点击复验。

---

## 1. 诉求

md 预览的属性卡片（frontmatter）里，**标签/列表属性的编辑交互向 Wolai 看齐**，并且**其他属性类型的编辑样式也参考同一套语言**。

对应代码：`frontend/app/view/preview/plugins/md-properties/`
（`obsidian-properties-card.tsx` = 卡片本体，`list-property-editor.tsx` = 今天的标签编辑器）。

---

## 2. Wolai 目标规格（实测）

### 2.1 触发与容器 **[实测]**

| 项 | 值 |
|---|---|
| 触发 | 单击属性值单元格 → 浮层；**无模态遮罩**（`MuiBackdrop-invisible`），点击外部关闭 |
| 容器 | `MuiPopover-paper`，`position:absolute`，`top/left` 由锚点算出，`transform-origin` 随锚点 |
| 尺寸 | 外层 paper 宽 **399px**（内层 `div` 显式 `width:399px`）；`max-height: calc(100% - 32px)`；`overflow-y:auto` |
| 圆角/背景/阴影 | `border-radius:6px`；`background: var(--wolai-modal-bg)`；`box-shadow: 0 0 0 1px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.2)` |

### 2.2 顶部「已选 + 内联输入」区 **[实测]**

- 容器：padding `8px 8px 0`，`flex-wrap: wrap`，`align-items: flex-start`
- 已选 chip：高 **22px**，`padding: 0 8px`，`border-radius: 3px`，`background: rgba(<色>, .2)`，`color: var(--color-calendar-graph-day-<色>-L5-bg)`，`margin: 0 6px 4px 0`
- chip 右侧 ×：12×12 svg，`#2C2C2C`
- 内联输入框：与 chip **同一行流内**，`flex: 1 1 0%`，`min-width: 60px`，高 22px，`font-size:14px`，**无边框无背景**，`placeholder="搜索或输入选项"`
- 分隔：容器 `box-shadow: 0 1px 0 var(--color-basic-200)`（1px 细线，非 border）

### 2.3 候选列表 **[实测]**

- 容器：padding `6px 4px`，纵向 flex
- 行高 **30px**；行内结构与已选 chip 同款（chip 预览 + 拖拽手柄 + 更多）
- 左侧拖拽手柄：18px 六点 svg `#BCB3B3`（react-beautiful-dnd，`data-rbd-draggable-id="draggable-tag-<名称>"`）
- 右侧「更多」：18px 三点 svg `#8E8E8E`
- 选中/高亮行：附加 class `_1kkrf`（hover 与选中同源）
- 行内 chip 与已选 chip 用**同一套颜色**，保证"列表里看到的 = 选进去的"

### 2.4 搜索 / 新建 **[实测]**

- 输入实时过滤：输入「扩展」→ 列表从 N 行收敛到 **1 行**，popover 高度随之从 166px 收到 76px
- 无匹配 → 列表只剩一行 `id="tag-addNew"`：`chip 预览（新建项取色 = 橙色 rgba(240,107,5,.2)）` + 「创建」文字 + 图标
- 即：**"搜索不到 = 创建"合并在同一行**，Enter 直接创建并选中（Wolai 没有独立的"新建"按钮）

### 2.5 单选 / 多选 / 数字 **[实测]**

- `select`（单选）与 `multi_select`（多选）**共用同一个 popover 组件**（实测单选 popover 同样 399×166，结构完全一致），区别只在点击候选项是 toggle 还是替换
- 单元格展示态：`min-height:32px`，`line-height:22px`，内容 `padding:5px 8px`
- `number` 单元格：内容**右对齐**，hover 出现 `node-btn`（aria-label「设置数字格式化...」，18×10 三点）

### 2.6 颜色体系 **[实测]**

12 个色系 × 5 级（L1→L5）：Default / Gray / DarkGray / Brown / Orange / Yellow / Green / Blue / Indigo / Purple / Pink / Red。
chip 用法固定为 **背景 = 该色 20%，文字 = 该色 L5**（如 Green：`rgba(61,217,89,.2)` + `#003840`）。

### 2.7 未拿到的样本 **[待验证]**

- `text`、`number` 单元格的**编辑态**：合成 MouseEvent 双击没能打开浮层/进入 contenteditable（Wolai 可能只信任真实 trusted 事件）。开工前用 CDP 真实点击复验一次。
- `date` / `checkbox` / `person` 等类型：该页面无样本。
- 列头（属性名）菜单（改名/改类型/删除）：本次未触发成功。

---

## 3. 现状差距

| 能力 | Snorkeling 现状 | Wolai | 差距 |
|---|---|---|---|
| 触发方式 | 点击行 → **行内 input**（行高不变，宽度受卡片列宽挤压） | 点击值 → **浮层** | 核心差距 |
| 已选值 | chip + `×`，删除需点到小按钮 | chip + `×`，且 chip 可拖拽排序 | 中 |
| 输入 | 单行 input，Enter/逗号成 chip，粘贴按逗号拆分 | 内联于 chip 流内，实时过滤候选 | 中 |
| 候选列表 | **无** | 有（过滤 + 创建 + 更多菜单 + 拖拽排序） | 大 |
| 新建选项 | 输入即成 chip，无提示 | 「创建 xxx」单独一行带预览 | 小 |
| 颜色 | 统一灰 chip | 12 色系稳定配色 | 中 |
| 多选/单选 | 无区分（都是 list） | 共用组件，行为不同 | 小 |
| 其他类型 | text/number/date/json 统一行内 input | 各有专用编辑形态 | 中 |
| boolean | 点击直接 toggle | 点击 toggle（同） | 无 |
| 新增属性 | 行内 key/value 两输入框 | `+` → 类型 + 命名 | P2 |
| 属性名菜单（改名/改类型/删除） | 无 | 有 | P2 |

---

## 4. 目标交互（本方案要落地的）

### 4.1 标签 / 列表 / 多选（P0 核心）

点击值 → 浮层（399px 宽，窄容器时 clamp 到 `min(399px, 100vw - 32px)`）：

```
┌────────────────────────────────────────┐
│ [🆕新建 ×] [📝初步处理 ×] 输⌕入…        │  ← 已选 chip 与输入框同流，高 22
├────────────────────────────────────────┤  ← 1px 细线
│ ⠿  [🌱新建中]         ⠇                │  ← 30px 行：拖拽 + chip + 更多
│ ⠿  [⏳进行中]         ⠇                │
└────────────────────────────────────────┘
```

行为（对齐实测）：
- 打开即聚焦输入框；输入 → 实时过滤候选
- Enter：有候选选中第一项；无候选 → 走「创建 xxx」
- 无匹配时列表**只显示一行「创建 <输入>」**，带 chip 预览（新建色取调色板下一色）
- Backspace 且输入为空 → 删最后一个 chip
- 点击候选：多选 = toggle；单选 = 替换并关闭
- Esc / 点击外部 → 关闭并**提交**
- 拖拽：候选列表内排序（P0 先做列表项排序，chip 排序 P1）

### 4.2 其他类型（P1，统一"点击值 → 浮层"语言）

| 类型 | 目标形态 |
|---|---|
| text | 浮层内自增高 `textarea`；Enter 换行，`Cmd/Ctrl+Enter` 或失焦提交，Esc 取消 |
| number | 浮层内单行输入，右对齐；非法值红色边 + 不提交（保留原值）；`Cmd+↑/↓` 步进（可选） |
| boolean | **保持点击直接 toggle**（Wolai  likewise），展示改为对勾/横杠 chip |
| date / datetime | 浮层内日期选择；P1 用原生 `<input type="date">` 内嵌，P2 换自定义日历面板 |
| json | 浮层内 textarea + 实时 `JSON.parse` 校验，错误红字提示且不提交 |
| link | 浮层内输入，保持 `[[wikilink]]` 语义 |
| 新增属性 | 保持行内 key/value（P2 再改 `+` → 类型 + 命名） |
| 属性名菜单 | P2 |

---

## 5. 技术方案

### 5.1 浮层：直接用 `@floating-ui/react`（已在依赖里 `^0.27.16`）

不复用 `app/element/popover.tsx` 的 `PopoverButton/PopoverContent` 组合，原因：它把 children 强制包成 `Button`、内部自管 `isOpen`，而我们需要**受控打开 + 锚点是值单元格 + 内容自定义尺寸**（且 `.popover-content` 有 `min-height:150px` 需要覆盖）。

新写一个薄壳组件：

```tsx
// property-value-popover.tsx
const { refs, floatingStyles, context } = useFloating({
  open, onOpenChange: onClose,
  placement: "bottom-start",
  middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 }), size({...})],
  whileElementsMounted: autoUpdate,
});
const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
```
内容走 `FloatingPortal`（挂 body，避免被 Markdown 容器 `overflow` 裁切）。

### 5.2 标签编辑器：`property-tag-editor.tsx`（取代 `list-property-editor.tsx`）

纯逻辑可测，输入输出不变（仍 `items: string[]` / `onChange`），因此**上层写回链路零改动**：
`onChange` → `obsidian-properties-card` 的 `commitListEdit` → `onDataChange` → `stringifyFrontmatterData` → `replaceFrontmatter` → `model.newFileContent`（草稿语义，Save/Cmd+S 落盘，与现状一致）。

Props：`items` / `options`（候选）/ `multiple` / `onChange` / `onClose`。

### 5.3 颜色：`property-palette.ts`

12 色系照抄 Wolai 的 `--color-calendar-graph-day-*` 数值（亮色：20% 背景 + L5 文字），
**取值方式 = 字符串 hash → 色系**（同一标签跨文件/跨会话颜色稳定，无需存储 schema）。
暗色模式：背景降到 12~16% 透明、文字用 L2（保证对比度），写进 `property-palette.ts` 一处开关。

### 5.4 候选值来源（关键取舍）

frontmatter 无 schema，Wolai 的候选来自属性自身的全局选项集。我们的选项：**P0 不做跨文件扫描**——候选 = 当前值全集；用户输入即创建（视觉与交互完全对齐）。
**P1 可选**：扫描同目录 `.md` 的 frontmatter（复用 `base-view/base-filter.ts` 已有的 `parseFrontmatter`），按同 key 聚合候选，异步 + 缓存。

### 5.5 文件清单

| 操作 | 文件 |
|---|---|
| NEW | `md-properties/property-value-popover.tsx` — floating-ui 浮层壳（定位/尺寸/关闭语义） |
| NEW | `md-properties/property-tag-editor.tsx` + `.scss` — Wolai 风格标签编辑器 |
| NEW | `md-properties/property-palette.ts` — 12 色调色板 + hash 选色 + 暗色适配 |
| NEW | `md-properties/property-tag-editor.test.tsx`、`property-palette.test.ts` |
| MOD | `md-properties/obsidian-properties-card.tsx` — 值区点击改为打开浮层；按类型分发编辑器 |
| MOD | `md-properties/obsidian-properties-card.scss` — 值区 hover 态（浅灰底 + 光标）、清理行内编辑样式 |
| DEP | `md-properties/list-property-editor.tsx`（被取代；先保留文件，P0 验证通过后删除） |
| MOD | `md-properties/obsidian-properties-card.test.tsx`（编辑交互断言更新） |
| MOD | `design-plans/obsidian-properties-plugin.md`（Phase 3 进度回写） |

### 5.6 关键约束（沿用既有设计，不踩坑）

- **inline-edit 坐标语义**：卡片是 waveblock，不输出文本、无 `data-source-line` → 双击不会进入 markdown inline-edit（Phase 1 已确认）。
- **重挂载风险（Phase 2.5 老坑）**：hover/滚动触发 Markdown 重渲染会让 waveblock 子树卸载 → 浮层被关掉。修法沿用：`transformedOutput` 用 `useMemo` + `waveBlockRenderers` 用 `useCallback` 稳定引用（现网已修），浮层打开期间避免卡片自身 state 抖动。
- **保存语义**：仍走草稿（`newFileContent`）。建议每次 toggle **即时写草稿**（对齐 Wolai 的即时感），Revert 可回退。

---

## 6. 分期

- **P0（核心诉求）**：标签/列表属性 → Wolai 风格浮层编辑器（含搜索过滤、创建行、chip 删除、颜色、键盘流）。其他类型暂不改。
- **P1**：其余类型浮层化（text/number/json/date/link/boolean chip 化）；候选值可选接入目录扫描；chip 拖拽排序。
- **P2**：新增属性改为 `+` → 类型 + 命名；属性名菜单（改名/改类型/删除）；date 自定义日历面板。

**开工前必做**：用 CDP 真实点击复验 Wolai 的 text / number 编辑态（2.7 的待验证项），确认 P1 的形态不是照着猜的。

---

## 7. 验收

1. `vitest`：`property-tag-editor.test.tsx`（过滤、创建、去重、Enter/Backspace/Esc、多选 toggle vs 单选替换）、`property-palette.test.ts`（hash 稳定、暗色映射）。
2. 实机 CDP：`node scripts/inspect-electron-ui.mjs screenshot` — 浮层打开态 / 搜索过滤态 / 创建态 / 暗色主题各一张，量出 399px 宽、22px chip、30px 行高。
3. 手动：Esc 与点击外部都能关闭并提交；改值后顶部 Save / Cmd+S 落盘、Revert 可回退；折叠面板时编辑态正确丢弃。
