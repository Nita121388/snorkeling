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

<!-- Component-related mistakes your team has made -->

(To be filled by the team)
