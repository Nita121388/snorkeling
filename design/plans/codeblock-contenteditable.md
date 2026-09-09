# 代码块：contenteditable 替换 textarea（P0 核心 + P1 语法高亮）

> 日期：2026-09-08
> 状态：P0 已实施（2026-09-08）

---

## 背景

textarea 是纯文本容器——没有 DOM 结构，无法做语法高亮、行号、括号匹配。预览态的代码块是结构化 DOM（`<pre><code>` + token `<span>`），两者本质不同，"所见即所得"在 textarea 框架里不可能实现。

改用 `<pre><code contenteditable>` 作为编辑容器，样式完全复用渲染态 CSS → 编辑态与预览态像素级一致。

---

## 架构

### P0（已实施）：contenteditable 替换 textarea（代码块专用）

**新增组件** `ContentEditableCodeEditor`：
- 一个 `<pre><code contenteditable>` 组件，接收纯文本、编辑回调
- 样式完全走 `.markdown pre.codeblock`（字体/字号/行高/padding/背景色），**复用已有 CSS**，不引入新的 token
- 自动增长高度（min-height = 原块高度，scrollHeight 自动撑开）
- Tab → 插入两个空格（Obsidian 行为）
- 粘贴 → 纯文本
- focus/selection 通过 ref 暴露（`focus({start, end})`、`getContent()`、`getCaret()`）
- **不做语法高亮**（P1）

**修改 `InlineEditOverlay`**：
- `blockKind === "code"` 时渲染 `<ContentEditableCodeEditor>`，其余仍渲染 textarea
- 同一个 `draftText` / `onTextChange` / `onKeyDown` / `onBlur` 贯穿两种编辑器

**修改 `useInlineEdit`**：
- 新增 `codeEditorRef = useRef<CodeEditorHandle>(null)`
- focus/auto-grow/blur 逻辑按 `blockKind === "code"` 分支
- textarea 的 `setSelectionRange` 不用于 code 分支，改用 `codeEditorRef.current.focus({start, end})`

### P1（下一步）：语法高亮

用 Prism（项目已有）在 blur 时对 contenteditable 重写 innerHTML 做语法高亮：
- **只在 blur 时高亮**（输入中不改 innerHTML，保持 undo 栈完整）
- 打开编辑时从渲染态获取已高亮的 innerHTML（token 结构）
- 输入中保持用户看到的颜色（上次高亮的结果）
- commit 时取 `textContent`（纯文本），不提交 HTML

---

## 关键对齐点（P0 已覆盖）

| 项目 | 做法 |
|---|---|
| 字体/行高/颜色 | `ContentEditableCodeEditor` 的 `<pre>` 直接继承 `.markdown pre.codeblock` CSS（同一套变量） |
| 内边距 | 同上，CSS 级别一致 |
| 顶栏（语言标签 + 操作按钮） | 渲染在 `ContentEditableCodeEditor` 外部，保持 `.codeblock-header` 不变 |
| 折叠按钮（>40行） | 折叠由调用者（`markdown.tsx` CodeBlock）控制；编辑态不做折叠 |
| "执行"按钮 | 保持在顶栏，可继续点击 |

---

## 文件变更清单

| 文件 | 变更 |
|---|---|
| `element/content-editable-code-editor.tsx` | **新增**：核心编辑器组件 |
| `element/content-editable-code-editor.scss` | **新增**：样式（复用 `.markdown pre.codeblock`） |
| `element/markdown-inline-edit.tsx` | **改**：Overlay 条件渲染 + hook 增加 codeEditorRef |
| `element/markdown.scss` | 不变（已有 `.inline-edit-overlay[data-block-kind="code"]` 规则可删或保留） |

---

## 验证

1. CDP 双击代码块 → 编辑态字体/行高/padding/颜色 与渲染态一致（之前已验证过 padding/lineHeight）
2. Tab 插入 2 空格、粘贴为纯文本、Cmd+Z undo
3. 76 个 inline-edit 测试继续通过
