# P2-B2: prose 块（p/h/quote）编辑提交收敛到块模型控制器

## 背景

P0（渲染 registry）、P1（统一 undo 栈 + 只读块模型）、P2-A（编辑控制器 + 渲染适配器）、
P2-B1（code 语言收敛最小闭环模板）已完成。地基与模板就绪。

**prose 块现状（已勘察，别再重查）：**

| 事实 | 位置 |
|---|---|
| prose 块（p/h/list/quote/blank）的 WYSIWYG 编辑走 `WysiwygEditor`（contentEditable） | wysiwyg-editor.tsx（612 行） |
| 每次 input：`serializeBlockDomToMarkdown(root, ctx)` → `onInput(md, caret)`（DOM 反序列化产物写入 draftText） | wysiwyg-editor.tsx `syncMirror`（187-194） |
| blur：`serializeBlockDomToMarkdown(root, ctx)` → `onBlur(md)` → `inlineEdit.commit` | wysiwyg-editor.tsx `handleBlur`（319-332）、markdown.tsx `onBlur={inlineEdit.commit}`（4386） |
| `commit()`：prose 用 `replaceSourceRange(fullText, startLine, endLine, committedDraft)` 按**裸行号**替换源码范围 → `onCommit` | markdown-inline-edit.tsx `commit`（902-909） |
| 根因：prose 提交定位用裸行号 + DOM 反序列化，未走块模型控制器，与其他块类型不统一 | — |

**P2-B1 已证明的收敛模板**：调用方构造 0-based `Block` → `editorController.apply({intent, block}, {text})`
→ 文本变换 → `handleInlineEditCommit`（进 undo 栈）。P2-B2 把这一模板套用到 prose 提交。

## 本任务范围（P2-B2）

把 prose 块（p / h / quote / blank）的 WYSIWYG 编辑**提交定位**从「裸行号 `replaceSourceRange`」
收敛到「块模型编辑控制器」。内容仍来自 DOM 反序列化（`serializeBlockDomToMarkdown`，这是
WYSIWYG 固有、成熟且正确），但**提交通道/定位**统一走块模型：新增 `replace-content` intent，
控制器内部用 `lineRangeToCharOffset(block.startLine, block.endLine)` 算出绝对字符偏移做替换，
返回 `{ text, caret }`。

收敛后所有块类型的线上编辑提交都走同一套（Block 坐标 + 意图 + 控制器 + undo 栈）模式，
消除裸行号分散定位，为后续 P2-B3（列表）与未来更纯粹的 AST 变换铺路。

## 验收标准（P2-B2）

1. **真实接入**：prose 块（p/h/quote/blank）WYSIWYG 编辑提交走块模型控制器
   （新增 `replace-content` intent）→ 文本变换 → `handleInlineEditCommit`（进 P1 undo 栈），
   行为与现状 `replaceSourceRange` 等价。
2. **行为零回归**：既有 509 个 element 测试全绿；prose 编辑（含多行段落 soft-break、标题、
   引用、空白块、回车分块、空内容提交）相关测试无回归。
3. **undo 可用**：prose 编辑后 Cmd+Z 可撤销（仍走 handleInlineEditCommit）。
4. **tsc** 无新增错误。
5. **可回滚**：收敛点单点可控；非 WYSIWYG 的 textarea 路径（draftText 为用户手输 markdown）
   保持 `replaceSourceRange` 不动，收敛仅作用于 `session.wysiwyg` 会话。

## 明确不做（本任务范围外）

- 不改 `wysiwyg-editor.tsx` 本体（contentEditable 编辑交互与 `serializeBlockDomToMarkdown`
  仍用于产出编辑内容——这是 WYSIWYG 的本质，内容来源不在此步改变）。
- 不收敛列表块（P2-B3，含 R1 列表项作用域难点）。
- 不收敛 table / code contentEditable 路径（各有专门编辑器）。
- 不改造 textarea（非 WYSIWYG）提交路径。
- 不解决 R2（扁平列表多 `<ul>` 编辑预览复用生产渲染器）。

## 关键取舍点（按「代码质量/设计标准/用户体验/产品竞争力」原则自主选定）

- **收敛定位而非内容来源**：prose 是自由文本编辑，内容必然来自 DOM 反序列化；本步收敛的是
  「提交定位通道」（裸行号 → 块模型控制器），这是渐进迁移的正确粒度，行为零变化、可回滚。
- **新增 `replace-content` intent 而非复用现有 intent**：现有 intent（turn-into / inline-style /
  toggle-task / set-code-lang / renumber-list）都是确定性变换，prose 提交是「整体替换块内容」，
  语义不同，需独立 intent，保持控制器意图模型清晰。
- **仅收敛 wysiwyg 会话**：textarea 路径（用户手输 markdown）与 wysiwyg 路径（DOM 反序列化）
  语义不同，分开收敛降低回归面。
- **控制器单例下沉到 block-model 共享**：P2-B1 在 markdown.tsx 持有实例，prose 收敛点在
  markdown-inline-edit 的 commit，需共享同一实例，避免两处各自 new。
