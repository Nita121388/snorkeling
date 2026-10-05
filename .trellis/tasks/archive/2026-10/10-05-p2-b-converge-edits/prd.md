# P2-B: 编辑提交收敛到 AST（逐个块类型关闭 DOM 反序列化）

## 背景

P0（渲染 registry）、P1（统一 undo 栈 + 只读块模型）、P2-A（编辑控制器 + 块模型渲染适配器
骨架）已完成。地基就绪。

当前编辑路径：`wysiwyg-editor`（contentEditable，612 行）每次 input 把编辑块的 DOM
`serializeBlockDomToMarkdown` 反序列化为 markdown → `handleInlineEditCommit`。这是
"让视图当模型"的根源，双向序列化有损、边界 case 爆炸。

## 现状（已勘察，别再重查）

| 事实 | 位置 |
|---|---|
| wysiwyg-editor 仅在 prose 块（p/h/list/quote/blank）启用，代码用 ContentEditableCodeEditor，表格用 table-block | markdown-inline-edit.tsx |
| 每次 input：serializeBlockDomToMarkdown(root, ctx) → onInput(md, caret)；blur → onBlur(content) | wysiwyg-editor.tsx syncMirror |
| 提交 → handleInlineEditCommit（P1 undo 栈已挂这） | markdown.tsx |
| dom-to-markdown：serializeBlockDomToMarkdown / serializeListDomToMarkdown / serializeInlineChildren | markdown-transform/dom-to-markdown.ts |
| P2-A 编辑控制器（createEditController + BlockEditIntent）已就绪，flag 关闭，未接编辑器 | block-model/editor-controller.ts |
| **R1 架构难点**：块模型坐标逐列表项，但 transformBlockType 作用于整组 → 组内单项 turn-into 会整组合并 | check 审查记录 |

## 目标

把线上编辑提交从「DOM 反序列化」切换到「基于块模型 + 文本变换」。**逐个块类型灰度**，
每个块类型一个 PR，可回滚。

## 本任务范围（P2-B 拆分）

P2-B 过大且最高风险，拆成可独立验证、各自可回滚的子步。**本任务 = P2-B1：最小闭环验证**。

- **P2-B1（本任务）**：选**最简单独立的块类型**，先建「编辑控制器驱动的提交」最小闭环，
  证明收敛可行且无回归。这是后续所有块类型的模板。
  - 候选：`code 语言`（最独立、单行、无 contentEditable 参与，已有 setCodeBlockLanguage +
    P2-A 的 set-code-lang intent）。这是**风险最低、价值清晰**的起点——它证明"意图 →
    P2-A 控制器 → 文本变换 → undo 栈"链路在真实编辑中可用。
  - 即：把 markdown.tsx 里 code 块的 onApplyLanguage 提交通道改为走 P2-A 编辑控制器（而非
    直接 setCodeBlockLanguage），作为收敛的第一个真实接入点。
- **P2-B2（后续任务）**：prose 块（p/h/quote）提交切换（涉及 wysiwyg-editor 改造 + R1 解决）。
- **P2-B3（后续任务）**：列表块提交切换（R1 核心难点）。

## 验收标准（P2-B1）

1. **真实接入**：code 块改语言走 P2-A 编辑控制器（set-code-lang intent）→ 文本变换 →
   handleInlineEditCommit（进 P1 undo 栈），行为与现有直接调用等价。
2. **行为零回归**：既有 508 个 element 测试全绿；code 语言相关测试无回归。
3. **undo 可用**：改语言后可 Cmd+Z 撤销。
4. **tsc** 无新增错误。
5. **可回滚**：改语言是单点接入，异常可快速 revert。

## 明确不做（本任务范围外）

- 不改造 wysiwyg-editor（prose/列表块收敛是 P2-B2/B3）。
- 不解决 R1（列表项作用域）——那是 P2-B3。
- 不改表格/代码编辑器本体。

## 关键取舍点（需用户确认）

- **起点选 code 语言**：风险最低、最独立。是否同意先收敛这一个点证明链路？（推荐）
- **是否把收敛动作集中在 markdown.tsx 单点**：改 code 语言只有一处调用（onApplyLanguage）。
