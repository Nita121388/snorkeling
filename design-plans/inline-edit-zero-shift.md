# 内联编辑「零跳变」方案（点击编辑时块样式不变）

> 时间：2026-09-08
> 目标：双击进入编辑时，**除了多出一个光标，块看起来完全没变**。

---

## 1. 现状机制（先说清楚它其实已经做对了一半）

编辑态不是把块替换掉，而是：
1. 原块加 `.inline-edit-hidden`（`visibility: hidden`，**保留布局盒**）
2. `createPortal` 到 body，在原块的 `getBoundingClientRect()` 位置上盖一个 `<textarea>`
3. `captureBlockTypography(targetEl)` 在打开时快照渲染块的排版，注入 textarea

已复制：`fontFamily / fontSize / fontWeight / fontStyle / lineHeight / letterSpacing`
（`markdown-inline-edit.tsx:61`）

**差的就是下面这些**——它们正是"点一下就变样"的来源。

---

## 2. 差异清单（逐条定位）

| # | 差异 | 证据 | 后果 |
|---|---|---|---|
| **D1** | **没复制 padding** | `captureBlockTypography` 只取 6 个字体属性 | 引用（`padding .714em 1em`）、代码块（`1.6em 1em .85em`）、列表缩进 → 文本**水平起点错位** |
| **D2** | **没复制 color** | textarea 用 `color: var(--main-text-color)`（`markdown.scss:645`） | 引用（次要色）、代码（`--codeblock-text-color`）→ **颜色跳变** |
| **D3** | **快照取错元素** | 快照取 `targetEl`（如 `<pre>`），但真实文本在子元素（`<pre><code>`，行高 1.6） | 代码块：快照 1.5，实际 1.6 → **行高跳变**（本次改代码块行高后新引入） |
| **D4** | **宽度被主动放大** | `width = max(target.width, renderRoot.right - target.left)`（`:351`） | 列表/表格单元格进入编辑时编辑框**变宽**、折行位置改变 |
| **D5** | **编辑态装饰** | `.inline-edit-active { box-shadow: inset 3px 0 accent; background: 4% accent }`（`:1176`） | 点击瞬间出现**竖条 + 底色**，这是最直观的"变了" |
| **D6** | **hover tint 闪烁** | `:hover` 4% accent（`:1172`），进入编辑后 hover 失效 | 底色"亮一下又灭" |
| **D7** | **white-space / word-break 未复制** | textarea 默认 `pre-wrap`，渲染是 `normal` | 折行位置差异 → 文字位置跳动 |
| **D8** | **font-variant-ligatures / text-indent / word-spacing / text-align 未复制** | — | 代码连字、对齐类文本微差 |

---

## 3. 修复方案

### S1 补全排版快照（治本，一处改动覆盖所有块类型）

`captureBlockTypography` 增加：

```ts
paddingTop/Right/Bottom/Left      // D1
color                              // D2
textIndent, wordSpacing, textTransform, textAlign   // D8
fontVariantLigatures               // D8（代码需要 none）
whiteSpace, wordBreak, overflowWrap // D7
```

### S2 快照取"真正渲染文本的那个元素"

```ts
const textEl = targetEl.matches("pre, blockquote, li, td, th")
    ? (targetEl.querySelector("code, .paragraph, p") ?? targetEl)
    : targetEl;
```
- 代码 → 取 `code`（行高 1.6 才对得上）✅ 修 D3
- 引用/表格 → 取内部文本容器
- 取不到就用 targetEl（安全回退）

### S3 去掉编辑态装饰

- `.inline-edit-active` 的 **4% 底色去掉**；inset 竖条改成**只在失焦风险时**（或干脆去掉）
- 理由：块已经是 `visibility:hidden` + textarea 覆盖，用户本来就看得见光标在哪，**不需要再加高亮**

### S4 宽度策略改为「严格对齐优先」

```ts
// 默认用 target.width（零跳变）；仅当块明显窄于内容区（列表/单元格）时才放宽，
// 且用 paddingLeft 对齐文本起点，保证折行位置尽量不变
const shouldExtend = targetRect.width < renderRect.width * 0.6;
```
- 普通段落/引用/代码/标题 → 严格 `target.width` ✅
- 列表项、表格单元格 → 仍扩展（打字连续性），但 `paddingLeft = targetRect.left - renderRect.left` 对齐起点

### S5 消掉 hover→编辑 的闪烁

编辑中的块加 `is-editing`，`:hover` tint 规则排除 `.is-editing`（`:not(.is-editing)`）→ 不再"亮一下又灭"。

### S6 光标落在点击处

进入编辑时若已有点击坐标 → 用 `document.caretRangeFromPoint` / 或按块内文本偏移换算 `selectionStart`，避免"光标总在开头，我点的明明是句尾"。

---

## 4. 各块对齐要点（按块确认）

| 块 | 关键对齐项 |
|---|---|
| 段落 | 行高（1.6）、padding、color |
| **代码** | 取 `code` 元素：等宽字体、**行高 1.6**、`--codeblock-text-color`、padding `1.6em 1em .85em`、`ligatures: none` |
| **引用** | padding `.4em 1em`、**次要色**、行高 1.6 |
| **标题** | 字号/字重（24/18/15 + 600）、行高 1.3 |
| **列表** | 缩进对齐（paddingLeft 对齐文本起点，而非 marker） |
| **表格单元格** | 行高 1.5、`tabular-nums`（已有）、padding `6px 10px` |

---

## 5. 关于「真正的所见即所得」

要说明白：现在编辑的是 **markdown 源码**，所以编辑态必然出现 `#`、`**`、`-` 这些标记——这是"源码编辑"框架下的极限，本方案做到的是**视觉零跳变**（字体/行高/颜色/位置都不变）。

真正的 WYSIWYG（像 Obsidian live preview：光标离开时隐藏语法标记、标题实时变大）需要换实现：
- 渲染元素本身 `contenteditable`
- 光标进出时切换"显示/隐藏标记"
- 改动大、风险高 → 列为 **P2**，等零跳变稳定后再评估

---

## 6. 已实施与实测（2026-09-08）

已改（对应上面 D1–D4、D7）：

| 项 | 做法 |
|---|---|
| **水平错位** | 快照补 `padding`：以**锚点块的 computed padding** 为基准，再叠加“文本元素相对内容区的额外缩进”（嵌套 li / p 的 margin、flex 前置元素）。不用文本元素的矩形差值——inline 文本（pre>code）的矩形是“文字墨迹”，算右侧/下侧会得到荒谬值（实测曾差出 305px） |
| **行高** | 新增 `resolveTextElement`：`pre` → 取 `code`，其余用 TreeWalker 找第一个非空文本的父元素 |
| **编辑框变宽** | `left` 固定为渲染块自身 left（原来取 `min(target.left, render.left)` 会让列表/缩进块整体左移）；宽度只在“块宽 < 内容区 60%”时才向右扩展 |
| **折行位置** | 复制 `overflowWrap / wordBreak / lineBreak`；宽度与内边距对齐后折行自然一致（`whiteSpace` 保持 `pre-wrap`，源码编辑必须） |

实测（CDP 真实双击，浅色 light 主题，dev 实例）：

| 块 | 水平起点 | 垂直起点 | 行高 | 宽度 |
|---|---|---|---|---|
| **代码块** `pre.codeblock` | 664 → 664（**差 0**） | 对齐（见注） | 20.8 → 20.8 ✅ | 567 → 567 ✅ |
| **标题** `.heading` | 658.3 → 658.3（**差 0**） | 150.5 → 150.5（**差 0**） | 42 → 42 ✅ | 588 → 588 ✅ |

> 注：代码块的“垂直/可用宽度”指标不可比——渲染侧取到的是 inline `code` 的**文字墨迹盒**（含半行距、宽度=最长行），编辑侧是**内容区**。真正可比的“文本起点”两项均为 0 差。
> 另：标题文本本来就缩进 18.8px（折叠按钮 10.8 + gap 8），编辑态补的正是这个值，所以对齐。

测试：76 passed（含 `markdown-inline-edit.test.ts` 65 个）。

**暂未做**（你这次没点名，留待决定）：D5 编辑态竖条/底色、D6 hover 闪烁、D8 颜色、S6 光标落在点击处。

---

## 7. 验收（能量化）

1. **computed style 对比**：进入编辑前后，对同一块读出 `font/lineHeight/padding/color/whiteSpace`，逐项比对应**全部相等**（写一个临时 CDP 脚本，一键输出差异表）
2. **像素对比**：编辑前后各截一张同区域图，做像素 diff，差异应只出现在**光标那一列**
3. **逐块走查**：段落 / 代码 / 引用 / 标题 / 列表 / 表格单元格 各一次，确认无宽度、无起点、无颜色跳变
4. **回归**：编辑内容提交后行号不错位、Revert 正常、滚动不抖（现有 overlay 用 `position: fixed` 已规避过闪烁循环，别改回去）
