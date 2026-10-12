# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Pattern: 统一 undo/redo 栈（useEditorHistory）

所有 Markdown 编辑（行内编辑、task checkbox、表格 cell、code 语言、列表重编号…）都已收敛到
单一提交通道 `handleInlineEditCommit`。undo 基准挂在**该收敛点**，而不是分散到各编辑器。

- `HistoryStack` 是**纯逻辑**（无 React/DOM，可单测），记录 `{ before, after }` 全文本快照；
  `useEditorHistory` 只是薄壳（useRef 持实例 + rev 驱动 canUndo/canRedo 重渲染）。
- **粒度**：按「单次提交通道调用」为一步（块级 undo，对标思源/我来）。每次提交都是
  「给定 text + 锚点行算出 nextText」，故只需全文本快照，无需 diff。
- **undo/redo 回填走独立 applyText 通道**（P1 = 仅更新 draft atom、不 arm autosave，可整体
  Revert）；与 preview-model 的 draft/saved 双态正交。
- **before 用「最后一次实际应用文本」ref**（lastAppliedTextRef）而非闭包 text——async atom
  round-trip 下闭包可能滞后一帧，且「撤销后再次编辑」时 must 同步该 ref，否则 undo 链被污染。
  - undo/redo 应用文本后，lastAppliedTextRef = 应用后的文本（与 commit 路径对称）。
- 程序性变换（normalize 等）用 `skipHistory` 不入 undo 栈。

**快捷键**：Cmd/Ctrl+Z → undo，Cmd/Ctrl+Shift+Z / Cmd+Y → redo；仅编辑生效时。

## Pattern: 编辑提交收敛到编辑控制器（block-model）

WYSIWYG 重构 P2 的目标是把「线上编辑提交」从 DOM 反序列化切换到基于块模型 + 文本变换。
收敛的模板（P2-B1 code 语言已落地）：

- **编辑器持有控制器单例**：`const editorController = createEditController();`（模块级，纯函数工厂无状态）。
- **提交走 intent**：`editorController.apply({ type: "<op>", block, ... }, { text }) → { text, caret }`，
  控制器内部映射到现有 markdown-transform 纯函数（transformBlockType / setCodeBlockLanguage / 等）。
- **结果仍走 handleInlineEditCommit**（P1 undo 栈 + autosave 不变）。

**based 语义（成败关键，勿改）**：
- `editSession.startLine`（会话）是 **1-based**（`safeLine = max(1, trunc(line))`）。
- `Block.startLine`（块模型）是 **0-based**。
- 收敛时调用方把 1-based 会话行号**转成 0-based Block.startLine**（`-1`）；控制器内部再
  `line1 = block.startLine + 1` 还原 1-based 给纯函数。**两处转换必须对称，否则 off-by-one**。

**整体替换（P2-B2 prose 提交）**：prose（p/h/quote/blank）的 WYSIWYG 提交是「整体替换块内容」
（内容来自 DOM 反序列化，已是完整块 markdown），不是确定性变换，用独立 `replace-content` intent：

```ts
editorController.apply(
  { type: "replace-content", block, content: committedDraft },
  { text: fullTextRef.current }
) // → { text, caret }；控制器用 lineRangeToCharOffset(block.startLine, block.endLine) 定位绝对偏移
```

- **块 kind 映射**：wysiwyg 的 `InlineEditBlockKind`（p/h/quote/blank）不是块模型的合法 kind；
  用 `inlineKindToTreeKind(kind, content)` 映射（h 从 committedDraft 的 `#` 前缀推断 heading 级别，
  quote→quote，p/blank→text）。`replace-content` 仅依赖块坐标，kind 只作数据模型语义。
- **控制器单例下沉共享**：收敛点分散在 markdown.tsx（code 语言）与 markdown-inline-edit（prose 提交）
  两处，共用 `block-model/editor-controller-instance.ts` 的模块级单例；`block-model/index.ts` 不转发
  导出单例（避免依赖环）。
- **空内容提交差异（已知契约）**：`replace-content` 是字符范围替换，空 content 会留下块尾空行
  （`"line1\n\nline3"`）；而 `replaceSourceRange` 的空 segment 语义是删整行不留空行。
  调用方以 `committedDraft.length > 0` 保证空内容回落原 `replaceSourceRange`（清空段落=删行）。
- **CRLF 已知差异**：`lineRangeToCharOffset` 按 `\n` 切，`\r` 归属块行内容，替换段内不重写 EOL，
  与 replaceSourceRange 的 dominant-EOL 重 join 有边界差异；wave 保存一律 `\n`，非生产场景。

**列表块收敛（P2-B3）**：list 的 WYSIWYG 提交复用同一 `replace-content` intent（语义与 prose
blur 提交一致——整体替换块内容），无需新 intent：

- **kind 映射**：wysiwyg 的 blockKind "list" 不区分 bulleted/numbered/todo，`inlineKindToTreeKind`
  从 committedDraft（DOM 序列化产物，首行即含 marker）首行推断：marker 后紧跟 `[ xX]` → todo、
  `^\s*\d{1,9}[.)]` → numbered、否则 bulleted。todo 正则必须锚定 marker 位置（与 block-type
  `ListItemLineRe` 语义一致），避免正文含 `[x]` 文本误判。
- **重复 marker 陷阱（成败关键）**：WYSIWYG 的 DOM 序列化产物（serializeListDomToMarkdown）
  **已含每行 marker**，提交必须整体替换，**不得再 wrapListMarker 包一层**（现状 bug：`- - apple`）。
  wrapListMarker 只用于 textarea 路径（draftText 为用户手输无 marker，需要补 marker 才能落盘）。
- **组级 vs 单项定位**：列表会话 startLine/endLine 由 resolveEditTargetFromEl 给出（普通 li 单项、
  含嵌套子列表提升到整组 ul/ol）；replace-content 的块坐标沿用会话行号 -1（0-based），天然支持
  两种作用域。R1（transformBlockType 组级塌缩）不在 blur 提交路径内，另属 turn-into 问题。

## Pattern: IME 合成守卫（P3）

中文/日文输入法 composition 期间，任何 DOM 手术（sentinel 插/删节点、live-kind 转换、
normalize）与快捷键拦截都会打断候选态。P3 建立的守卫模式：

- **面板/快捷键入口统一守卫**：`handleEditorKeyDown` 入口 `if (e.nativeEvent.isComposing) return;`
  一次性覆盖 slash/emoji/slashEmoji 三面板 + mod 快捷键 + 导航——组合中 Enter/方向键只确认候选词。
- **编辑器生命周期守卫**：WysiwygEditor 持 `compositionActiveRef`（onCompositionStart/End），
  `handleInput` 组合中跳过 detectTypingTrigger + syncMirror（避免哨兵 DOM 手术打断组合）；
  `handleBlur` 组合中不提交；`compositionend` 后统一补一次 sync。
- **DOM 是事实源**：WYSIWYG 提交/同步一律以 DOM 序列化（getMarkdown）为准，draftText 只是镜像。
  组合中 syncMirror 被跳过后 draftText 会滞后——因此 commit() 对 wysiwyg 会话在 content 缺失
  时优先 `getMarkdown()`（消除切块时用陈旧 draftText 的丢字/串块风险）。
- **原生语义放行**：WYSIWYG 列表的 Enter（建 li）、空项 Backspace（合并）、Tab（缩进）都交给
  contentEditable 原生处理（allowNativeEnter / allowNativeBackspaceOnEmpty / applyListIndent
  的 execCommand），共享 keydown 不得 preventDefault 吞掉原生行为。
- **选区上报**：WYSIWYG 下 `document selectionchange` → sentinelMarkdownSelection（两端哨兵）
  上报 markdown 空间选区 → FloatingToolbar；折叠选区不插哨兵；组合中不上报。
- **性能**：caret/textLen 等序列化计算惰性求值（仅导航键需要），普通键击不得每次全量序列化。

## Pattern: 选区工具栏锚定（P3 F10）

工具栏锚定当前 DOM selection 的 `getBoundingClientRect()`（textarea 与 WYSIWYG 都在编辑中，
selection 即选中文字范围），而非块顶——多行块选中文案时工具栏跟随选区。选区异常时回落
块顶锚定。

## Pattern: 行内格式闭合配对 live 转换（P3 F5）

WYSIWYG 的「所见即所得」打字手感：输入 `**bold**` 光标到末尾即变粗体，而非提交后才变。
克制方案（不做全量 markdown 扫描器）：

- **纯函数检测**（block-type.ts `detectClosedInlinePair`）：caret 前文本匹配已闭合配对
  `**bold**` / `*em*` / `` `code` `` / `~~del~~`（`$` 锚定 + 内容行无换行 + 单 `*` 不误伤
  `**`）。返回 `{ marker, inner, innerStart }`。
- **最小 DOM 手术**（WysiwygEditor `applyClosedInlineFormatting`）：配对必须完整落在 anchor
  文本节点内（用户连续输入同一节点）；构造 前文 + `<strong|em|code|del>` 内容 + 后文 替换；
  光标用**父容器索引定位**（不依赖 nextSibling——配对在段落末尾时 nextSibling 为 null）。
- **防御**：组合中不执行（compositionActiveRef）；跨节点/内容不匹配/节点非文本 → 静默跳过；
  handleInput 与 compositionend 后各调一次（幂等）。
- 序列化闭环：STRONG/EM/DEL/CODE → `**`/`*`/`~~`/` 由 dom-to-markdown 的 wrap() 保证。

## Pattern: 拖拽嵌套（P3 F7）

块拖拽除 before/after 重排外支持**嵌套**（拖入列表项成为子项，思源标志性手势）：

- **纯函数**（`moveBlockRange` inside 模式）：被拖块插入目标项之后，整体缩进到
  `insideIndent`（目标缩进 + 2），块内相对缩进保留（子列表层级不变）。不添分隔空行。
- **判定**（dragover/drop）：悬停元素是 LI 且指针在左 25% 嵌套区 → inside。**用 hovered LI
  自身定位**（不 promote 到父列表），否则含嵌套子列表的 LI 会错位到第一项。
- **指示**：inside 渲染包裹目标项的虚线框（`.markdown-block-drop-target`），before/after 保留
  横线指示。
- **坐标模型**：insert/move/delete 是**跨块范围操作**，不走 block-model 的单块坐标 intent
  （G10 决策不做——强塞会扭曲单块模型；保持纯函数 + 统一提交通道 handleInlineEditCommit）。

## Pattern: 列表是「整表编辑」，不是「按项编辑」（step1 D1/F3）

渲染态每个 `<ul>` 与 `<li>` 都带 `data-source-line`，`closest()` 永远命中最近的 `LI`。
因此点击解析必须**无条件把 LI 提升到所属 `UL/OL`**（`resolveEditTargetFromElement`）：

- 裸 `<li>` 作编辑种子是非法 HTML，其盒子与渲染态 `<ul><li>` 不同 → 列表进编辑「位置偏移」
- `UL` 带 `data-source-line-end`，编辑行范围才覆盖整表（提交不丢项）
- 取舍：放弃「按项编辑」粒度，与 Obsidian Live Preview / 思源一致

**嵌套保真（F3）**：点内层项会提升到**内层** `ul`，而序列化从 depth 0 起算、区间替换不重缩进，
所以提交前必须补回源码首行的缩进（`captureWysiwygInfo` 捕获 → `indentListDraft` 应用）；
否则内层列表会被提升为顶层。

### 结构自持 + 规范化（step2，必读）

**不要把结构操作交给浏览器**。`document.execCommand("indent")` 产出的嵌套列表会
**直接挂在 `ul` 下而不在任何 `li` 里**（实测），这是**数据丢失**的直接来源：
老版 `serializeListDomToMarkdown` 先 `filter` 出 `li` 再递归，游离的 `ul` 子树
既不在 `items` 里也无人访问 → 整项被静默丢弃（Tab 缩进后提交，源码少一项）。

契约（`markdown-transform/list-dom.ts`，纯函数可直测）：

- **不变式**：`ul/ol` 的直接子元素只能是 `li`。`normalizeListDom(root)` 负责收敛：
  游离子列表并入紧邻前一个 `li`（无前一个则并入最后一个 `li`；列表内无 `li` 时
  **整段提升并删除因此变空的列表**——留着空列表会让序列化命中它又把内容丢掉）。
  必须幂等。收口在 `input` 事件后（原生 Enter/Backspace/粘贴都能覆盖）+ 种子落地后。
- **结构操作自持**：Tab = 成为紧邻前一个兄弟 `li` 的子列表项（已有则追加不新建）；
  Shift+Tab = 移出到父 `li` 之后（父列表空则删）。第一项 Tab / 顶层 Shift+Tab = no-op。
  缩进**字面量只由序列化产出**（2 空格/层），操作只改 DOM 嵌套。
- **序列化兜底**：即使结构非规范，`serializeListDomToMarkdown` 也必须输出游离列表
  （按嵌套处理），**绝不静默丢弃**——任何“只遍历规范结构”的写法都是潜在丢数据。
- **光标锚定**：结构变更前 `plantCaretAnchor` 插 `<wbr>`，变更后 `focusByAnchor` 按邻居
  文本节点重建 collapsed Range（思源 `focusByWbr` 语义）。锚点不得残留在 DOM。

> 为何不照抄思源的 div 块载体：那需要自研 Enter/Tab/Backspace/粘贴整套语义（思源 `list.ts` 71KB）。
> 实测 Enter 原生行为可用，真正的病因是「结构未被自持 + 序列化不兼容非规范结构」，
> 因此以最小成本拿到正确性；div 化推迟到块身份（step3）之后再评估。

## Pattern: 内联编辑器的尺寸与种子契约（step1 D2/F4/F5/F6）

**尺寸**：overlay 是 `position: fixed` 的定位盒，**绝不能用固定 height 承载可增长内容**——
原块是 `visibility: hidden`（保留布局盒），编辑器一变高就被 `overflow:hidden` 裁掉且不可达（「显示不全」）。
契约：`minHeight` = 目标矩形高，`height: auto`，`maxHeight` 用**同一** `min()`/`max()` 边界，`overflowY: auto`；
CSS `min-height` 在算法上**压过** `max-height`，所以 `minHeight` 必须写成
`min(块高, max(160px, calc(100vh - top - 8px)))`，否则块本身高于视口时 `maxHeight` 失效。

**种子空白**：渲染态 `white-space: normal` 会折叠块间空白，而编辑器继承 `[contenteditable]` 的 `pre-wrap`
→ 松散列表里 `mdast-util-to-hast` 注入的 `"\n"`（以及 blockquote 包装的首尾换行）
每个都占一整行。`captureWysiwygInfo` 必须过一遍 `stripInsignificantWhitespace()`（非空即遍历，
早退正则容易漏掉首尾空白），且只在「有块级兄弟节点」时删空白，以免误删行内空格。

**光标落点**：`WysiwygEditorHandle.focus(offset?)` 支持渲染态文本偏移（列表分支走 `placeCaretByTextOffset`）。
overlay 必须把会话的 `caretOffset` 透传给它，否则点列表第 N 项时光标落到表头/段尾。

## Pattern: 提交前的结构性空壳守卫（数据安全，必读）

**背景**：WYSIWYG 提交取自 DOM 序列化，而**空的编辑器根**序列化出来正是该块类型的「空壳」
（`p` → `""`、`h` → `"##"`、`list` → `"- "`、`quote` → `">"`）。若它与 `initialContent` 不等，
就会被判定为「用户已修改」而写盘——曾在真实笔记上把整段引用覆盖成 `>`（不可恢复）。

**契约**（`markdown-inline-edit.tsx` 的 `commit()`）：

1. 空壳守卫（`isEmptyBlockShellDraft`）必须放在**所有分支之前**。尤其 `placeholder` 分支：
   `handleNavigateUp` 会以 `placeholder=true` 打开**上一个既有非空块**，
   零输入失焦就会用空壳覆写它——这是最容易漏的一条路径。
2. 判别按 kind 从严/从宽：`h/list/p` 的空壳正是「合法清空」留下的样子 → 两侧
   （DOM 序列化 vs 镜像 `draftText`）**同时**为空壳即视为合法清空；只有
   「镜像仍有内容而 DOM 塌成空壳」（= 种子从未落地）才拦。`quote` 的空壳是非空的 `>`
   且清空整段引用罕见 → 从严拦下（丢内容不可恢复，拦下只是不便）。
3. `placeholder` 分支内再补一条 no-op：「`draftText === initialContent` 且原文非空」→ 不重写既有块。
   必须放在「空稿 revert 预插入行」**之后**，否则预插入行会残留。
4. 任何守卫都**不得**阻止合法清空：`unchangedDraft`（`draftText === initialContent`）用于
   「未落种子/未编辑」；结构性空壳用于「种子从未承载内容」。

**Prevention**：任何「DOM 是事实源」的提交路径，都必须能回答「用户到底编辑了没有」。
仅靠「序列化结果 != 原文」是不够的——空壳恰好不等于原文。

## Pattern: 渲染器不得把 react-markdown 的 `node` 透传到 DOM（step1 D5）

react-markdown 往每个元素的 props 里注入 `node` 对象。写 `<li {...props} />` 会让 React 把它
序列化成 `node="[object Object]"`，并被克隆进 WYSIWYG 种子。

- 一律用 `domProps(props)`（`markdown-render/shared.ts`）展开，`srcLineAttrs(props)` 仍传**未剥离**的 props 取行号
- 例外：`WaveBlock` 这类纯组件不落到 DOM，可保持 `{...props}`
- 验证方式：渲染后断言不存在 `[node]` 元素且全页无 `[object Object]`

## Pattern: sanitize schema 的同名属性只能定义一次（必读，曾致静默失效）

`hast-util-sanitize` 的 `findDefinition`（`node_modules/hast-util-sanitize/lib/index.js:744`）
对**同一个 tag 上的同名属性只取第一条定义**，后面的条目整条被忽略 ——
多条 `["className", …]` **不取并集，只有第一条生效**。

后果实例：span 曾写

```js
["className", /^hljs-./],                        // ← 只有这条生效
["className", /^markdown-alert/],
["className", "markdown-alert-emoji-btn", "is-empty"],
```

于是 10-08 用来修竖排的 `span.markdown-alert-title-text` 被静默剥成 `class=""`，
CSS 从未生效（沙箱实测：span `flex` 仍是 `0 1 auto`、`min-width: auto`）。

**规则**：
- 同一 tag 的同一属性名**只出现一次**，放宽时把允许值**并进已有那一条**。
- schema 由 `frontend/app/element/markdown-sanitize-schema.ts` 导出，
  **测试必须 import 真实 schema**，不得再写「镜像 schema」（顺序漂移正是漏掉此 bug 的原因）。

## Pattern: callout / 引用块是一等块（R1–R4）

- **块身份**：`remarkCalloutAlert` 产出 `<calloutalert class="markdown-alert markdown-alert-{type}">`
  并**保留原 blockquote 的 `position`**（start+end）→ 渲染器用 `srcLineAttrs(props)` 注入
  `data-source-line`/`-end`。没有 position 就没有块身份（点标题毫无反应）。
- **CSS**：自定义 tag 默认 inline，`.markdown-alert` 必须显式 `display: block`。
- **点击目标**：`resolveEditTargetFromElement` 必须**最前面**识别
  `calloutalert[data-source-line], .markdown-alert[data-source-line]` → 整块 `blockKind: "quote"`。
  放在 `closest("[data-source-line]")` 之后就会先命中正文 `<p>`（kind `"p"`），
  只编辑一行**并写掉该行的 `> ` 前缀**。
- **干净种子**（`calloutSeedHtml`）：必须去掉装饰性的 emoji `<button>`（`<button>` 走序列化
  default 分支会被 unwrap、把 emoji 泄漏进正文），标题段降为普通首段。
- **标记保真**（`captureCalloutPrefix` / `applyCalloutPrefix`）：从源码首行取 `[!TYPE]` +
  emoji 的**原文**（保大小写），提交时回写到序列化首行 `> ` 之后；前缀为空（普通引用）
  **不得凭空新增** `[!quote]`。回写必须在 `commit()` 的空壳守卫**之后** —— 守卫靠回写前的
  裸 `>` 才能认出空壳。
- 编辑 emoji 选择器复用同一套前缀正则语义（`markdown.tsx` 的 `applyCalloutEmoji`）。

## Pattern: 块身份是「身份」，行号是「坐标」（step3，必读）

markdown 文件模型下，**行号是写盘坐标、不可替代** —— 要改文件就必须知道改哪几行。
思源能只靠 `data-node-id`，是因为它的「源码」就是块树（`.sy` JSON），不存在「块 → 文本行」
的映射问题。所以我们**加身份，不换坐标**：

- **身份**：`remarkBlockIds` 给块级节点打
  `data-block-id = blk-<fnv1a(块文本)>-<同摘要出现序号>`。纯函数（内容 + 文档内顺序）、
  不写进源文件（用户资产零污染）、内容相同的重复块靠序号消歧。
- **落地方式**：插件设 `hProperties.dataBlockId` → sanitize 放行 `dataBlockId`
  （**只一条**）→ 渲染器收到的 prop 名是 **`data-block-id`** → 靠既有
  `{...domProps(props)}` 自然落 DOM。自持根节点的渲染器（`heading`、`code-block`）需单独补。
- **提交前置决策点**（`prepareInlineEditCommit`，纯函数）顺序不可颠倒：
  **重定位 → 陈旧检测 → 空壳守卫 → placeholder → 写盘**。
  * 重定位：`[data-block-id=…][data-source-line]`（复合选择器跳过无坐标的 wrapper）
    命中则用**当前**行号，行号位移后仍写对位置。
  * **退化重定位**（`relocateByContent`）：id 含「同摘要序号」，编辑一个内容相同的兄弟块
    会让本块序号前移、精确命中落空 —— 此时按「内容唯一匹配」找回；**多个候选 = 真歧义
    → 不猜**，退回捕获范围。宁可失去重定位能力，绝不改到另一个块。
  * 陈旧检测：当前切片与 `initialContent` 不符 → **中止写入**（宁可丢一次编辑）。
    归一化必须收敛到 `initialContentFor(kind, slice)` 一个函数（list 去 marker、code 去围栏），
    `beginEdit` 与守卫共用，否则两侧必漂移。

## Pattern: md-core 边界不变量（P0 C1/C2/C3，必读）

目标：让「markdown 编辑部分可单独抽离」成为**可验证的不变量**（抽离本身是下一个任务）。

**依赖方向（单向）**

```
markdown-inline-edit.tsx（编辑壳）
      │ 只 re-export，不再拥有实现
      ▼
markdown-transform/ block-model/ remark/ markdown-render/
      │ 只允许 →（不可反）
      ▼
markdown-core/（host.ts / markdown-refs.ts / classnames.ts）
      │ 默认实现只能**动态** import
      ▼
宿主（@/view, @/store, @/util, @/app/view, @/app/store, jōtai, wos）
```

- **块区间纯函数住在 `markdown-transform/block-range.ts`**（`replaceSourceRange` / `spliceInsertBlock` /
  `deleteBlockRange` / `moveBlockRange` + `MoveBlockResult`）。编辑壳 `markdown-inline-edit.tsx`
  **import 并 re-export** 同名符号，对外 API 逐字不变（`markdown.tsx` 等引用点无需改动）。
  新增块区间逻辑请加到 `block-range.ts`，不要加回编辑壳。
- **宿主能力只走 `MdHostAdapter`**：核心目录不得直接 import 宿主的图片解析 / 灯箱 / 右键菜单 /
  链接导航 / 引用语法解析，改调 `getMdHost().xxx(...)`。默认实现在 `markdown-core/host.ts` 里，
  用**动态 import**（`await import("@/...")`）/`React.lazy` 回退到原 Wave 路径；同步渲染类能力
  （灯箱）也必须是动态加载，否则本文件就变成静态宿主依赖了。
- **引用语法解析是纯函数**：`parseMarkdownFileLineReference` / `parseMarkdownWikiLink` /
  `makeMarkdownWikiLinkHref` 住在 `markdown-core/markdown-refs.ts`；`file-link-navigation` 反向
  import + re-export。改语法只改这一处，否则两处实现必漂移。

**门禁**：`frontend/app/element/markdown-core-boundary.test.ts`（随 `frontend/app/element` 套件跑）。

- 扫描 4 个目录的非测试源文件，抽出 `from "…"` 与 `import("…")` 两种 specifier；**相对路径先解析**
  再判定，所以 `../../store/global` 这类绕过 alias 前缀检查的写法同样会被抓。
- 禁列（无豁免）：`frontend/app/view/`、`frontend/app/store/`、`frontend/util/`、裸包 `jotai`/`wos`、
  模块名 `markdown-inline-edit`。
- 落在 4 个核心目录 / `markdown-core/` 内 → 允许；落在其它任何地方 → **必须**进
  `CORE_SHARED_ALLOWLIST` 并写明 `reason`（白名单 = Phase B 的搬移/保留决策清单）。
- 白名单还可是空转：禁止出现未使用的残留条目（test 会报 stale）。
- **先失败后通过是可验证的**：临时在核心目录加 `import { atom } from "jotai"` /
  `import { x } from "../../store/global"` / `../markdown-inline-edit`，三条都会报 `文件:行 + 原文`。

**新增跨目录依赖时的正确做法**：先问「这是纯逻辑吗？」——是就下沉到 `markdown-transform/`（或
`markdown-core/` 纯模块）；不是就加到 `markdown-core/host.ts` 的 adapter 能力里并用动态 import 回退。
只有两者都不适用（如 schema/UI 集成点、block-editor 组件）才登记白名单 + reason。

## Common Mistake: 把编辑提交通道与只读门控混用

**Symptom**: P0 拆分 markdown.tsx 块渲染器时，`img` 图片编辑和 `pre` 代码块改语言在 Preview 模式下
只更新草稿 atom，不再触发 1.5s 自动落盘（需手动 ⌘S）。

**Cause**: 原实现 `MarkdownImg`/`pre.onApplyLanguage` 提交走的是 `handleInlineEditCommit` 包装器
（包含列表重编号 + `scheduleInlineEditAutosave` 自动落盘），拆分后 registry 误用了裸 prop
`onInlineEditCommit`。

**Fix**: `MarkdownRenderContext` 新增 `commitFullText` 字段承载包装器（`markdown.tsx` 传
`commitFullText: handleInlineEditCommit`）；registry 的 `img`/`pre` 用 `ctx.commitFullText` 提交，
只读门控仍用裸 `ctx.onInlineEditCommit` 判断。

**Prevention**: 拆块渲染器时，凡提交路径用包装器（含副作用）的，必须把它作为独立 context 字段传入；
门控（是否可编辑）与提交（真正写入）是两个不同通道，不要混成一个。<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

(To be filled by the team)

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

---

## Common Mistakes

### 用「渲染结果 != 原文」当作「用户改过」

**Symptom**: 用户什么都没做，引用块内容被覆盖成 `>`（真实笔记，不可恢复）。

**Cause**: WYSIWYG 提交取自 DOM 序列化；空编辑器根 → 空壳，与 `initialContent` 不等
→ 判定为已修改 → 写盘。

**Fix / Prevention**: 见上「提交前的结构性空壳守卫」。任何写盘路径都要能区分
「未编辑」「合法清空」「种子未落地」三种状态。

### 在 contentEditable 里直接 spawn 浏览器认识的语义列表

**Symptom**: 列表进编辑后缩进/位置偏移、项被浏览器拆并、提交后丢项。

**Cause**: `<li>` 是浏览器认识的标签，contentEditable 会规范化它（拆并 li、移走文本节点、注入 `<br>`）；
另外裸 `<li>` 当种子（无 `<ul>` 包裹）本身也不合法。

**Fix / Prevention**: 种子必须是完整 `<ul>/<ol>`；渲染态不要让 `<li>` 独占块身份（提升到列表元素）。
长期方案见 `方案/Block-Editor 笔记编辑体验升级/07-彻底改造-对标思源-块身份与逐类型覆盖.md`
（列表改 div 块载体，彻底绕开浏览器规范化）。

### 断言 `<ul>/<ol>` 的子元素时忽略空白文本节点

**Symptom**: 松散列表进编辑后行距翻倍、块高度约 2×。

**Cause**: 渲染态 `white-space: normal` 折叠块间空白，编辑器却是 `pre-wrap`。

**Fix / Prevention**: 提交/种子路径统一过 `stripInsignificantWhitespace()`。

### 只遍历「规范结构」，把非规范节点静默丢掉

**Symptom**: 在列表项上按 Tab 缩进，提交后那一项从文件里消失（数据丢失）。

**Cause**: 浏览器 `execCommand("indent")` 产出的嵌套 `ul` 直接挂在 `ul` 下；
序列化先 `filter` 出 `li` 再递归 → 游离子树无人访问 → 被丢弃。

**Fix / Prevention**: 见「结构自持 + 规范化」。任何序列化器都必须对
“不在预期位置的子节点”有**兜底输出**，宁可输出得难看也不能丢。


### 在 sanitize schema 里对同一个属性写多条定义

**Symptom**: 某个 class 加进 schema 后样式/行为完全没变化，DOM 上看到 `class=""`。

**Cause**: `findDefinition` 只取第一条同名属性定义，后续条目整条被忽略（不取并集）。

**Fix / Prevention**: 见「sanitize schema 的同名属性只能定义一次」；测试 import 真实 schema。

### 把「紧邻 `<br>` 的换行」当成内容

**Symptom**: 引用块/callout 提交后凭空多出一条裸 `>` 空行，一行软换行内容被拆成两个段落。

**Cause**: 渲染器在软换行前后插 `\n`（`<p>a<br>\nb</p>`）。渲染态 `normal` 下不可见，
编辑器却是 `pre-wrap`，它成了第二个真实换行。**字符串层**不处理就没有机会了 ——
`innerHTML` 重新解析时相邻文本节点会被合并（`"\nb"`），DOM 层再也认不出那是个独立空白节点。

**Fix / Prevention**: 种子归一化在字符串层做（`normalizeBreaksAroundNewlines`），
只动紧贴 `<br>` 的那一个换行。
### UI 交互验证时忽略渲染进程可见性

**Symptom**: CDP `click` / `key` 完全无效——DOM 上连 `mousedown` 都收不到，
`window.getSelection()` 能被 eval 改但真实按键被应用抢走。

**Cause**: 窗口被遮挡/最小化时 `document.hidden === true`，**Chromium 不向隐藏的
渲染进程投递输入事件**（合成事件仍可用，所以容易误判为“应用没响应”）。
另：合成 `KeyboardEvent` 不触发浏览器默认编辑动作（Enter 分裂列表项、Tab 缩进、
Backspace 合并），验证这些行为必须用 `scripts/inspect-electron-ui.mjs key`。

**Fix / Prevention**: 先查 `document.visibilityState`；必要时把窗口置前，
或用 `Page.setWebLifecycleState({state:"active"})` + `Emulation.setFocusEmulationEnabled`
并**保持 CDP 长连接**（会话结束即失效）。进编辑态用真 CDP `click`（合成点击只设选区、不给 DOM 焦点）。
隔离沙箱：`node scripts/dev-isolated.mjs --profile scratch --vite-port 51752 --cdp-port 9333`，
并把沙箱 DB 里**所有** md 路径改写到草稿文件，避免误写真实笔记。

## overlay 样式不变量（编辑态只允许加「供能性」）

- `.inline-edit-overlay` 作用域**不得**声明结构性样式（padding / margin / border / background / font-* / line-height / width / height / display / overflow …）。
  理由：编辑态必须让**预览渲染器的样式自然生效**；手工镜像一份必然漂移 —— 10-08 `callout` 标题竖排修复「实际没生效」就是同类事故。
- 允许：caret / ::selection / :hover / :focus-visible / cursor / overlay 自身包裹布局。
- 门禁：`frontend/app/element/overlay-style-contract.test.ts`
  （现存结构性镜像逐条登记台账 + reason + todo；**新增未登记即失败**；台账条目消失也失败，防止台账失真）。
- token：引用的 `var(--x)` 必须有定义。门禁：`frontend/app/element/token-existence.test.ts`
  （已知悬空 token 逐条豁免并带 reason/todo；`todo="fix-token-2"` = 待修的真实视觉问题）。
- 扫描范围只覆盖我们负责的范围（`frontend/app/element` + `packages/md-core/src`），宿主其它模块的历史悬空 token 不在本门禁职责内。
