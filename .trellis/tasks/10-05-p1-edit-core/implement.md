# P1 Implement Plan

## 状态：实施完成 ✓（2026-10-05，已过 trellis-check 审查）

## 已交付
- **P1-A 统一 undo/redo 栈**：新建 `frontend/app/element/use-editor-history.ts`（HistoryStack 纯类 +
  useEditorHistory 薄壳），接入 markdown.tsx 的 handleInlineEditCommit 收敛点（record + lastAppliedTextRef），
  keydown 加 Cmd/Ctrl+Z / Cmd+Shift+Z / Cmd+Y；normalize 走 skipHistory 不入栈。6 个单测。
- **P1-B AST 块模型 MVP**：新建 `frontend/app/element/markdown-transform/tree.ts`（buildBlockTree +
  Block 类型 + 稳定 id），复用 block-type 的 findBlockRangeAtLine。15 个单测。

## trellis-check 审查发现并修复
1. **P1-A undo 链 bug**：lastAppliedTextRef 只在正常 commit 路径更新，undo 回填路径未更新 →
  「撤销后再次编辑」时 before 取到过期文本。修复：applyTextForHistory 加 lastAppliedTextRef.current = t。
2. **P1-B hr 缺口**：block-type.ts 的 BlockKind 无 hr，findBlockRangeAtLine 会把 `***` 当 text 并跨行
  并入相邻段落。修复：tree.ts 内置 HrLineRe + isHrLine 前置识别 + clipAtHr 裁剪（不改 block-type.ts，
  避免波及编辑引擎），BlockKind 扩展为 TreeBlockKind（+"hr"）。

## 验证
- element 37 文件 / 490 测试全绿（469 基线 + 21 新：6 Hook + 15 tree）；tsc 新文件零错误
  （仅预存在 markdown.tsx(442) loadable 报错）。

---

## 阶段划分

P1 分两个子交付，各自独立可验证：

- **P1-A 统一 undo/redo 栈（核心交付，优先）**
- **P1-B AST 块模型 MVP（只读 buildBlockTree + 坐标）**

先做 P1-A（用户可立即感知的 Cmd+Z），再做 P1-B（地基）。两者可同分支先后提交。

---

## P1-A：统一 undo/redo 栈

### Step 1 新建 `frontend/app/element/use-editor-history.ts`
实现 `useEditorHistory({text, onCommit, resetKey})`：
- ref 持最新 `text`；包装 `onCommit` 记录 `{before, after}` 入 undo 栈（`before!==after` 才入）。
- 栈上限 200 步；`undo()`/`redo()` 回填文本到 `onCommit`，同时维护 redo 栈。
- `clear()` / resetKey 变化时清空两栈。
- 返回 `{undo, redo, canUndo, canRedo, clear}`。

### Step 2 接入 markdown.tsx
- 实例化 Hook：`const history = useEditorHistory({ text, onCommit: handleInlineEditCommit, resetKey })`。
- 关键：**undo/redo 回填走 onCommit 但不触发 autosave**。当前 `handleInlineEditCommit` 会
  `scheduleInlineEditAutosave()`。需为 undo 提供一条"提交到 draft 但不落盘"的路径：
  在 Hook 内部不直接调 onCommit，而是暴露 `commitNoSave`（只 `globalStore.set(newFileContent, t)`，
  不 schedule）。markdown.tsx 把 `commitNoSave` 传给 Hook 作为回填函数，原 `handleInlineEditCommit`
  仍用于正常编辑。
- 加 keydown：`Cmd/Ctrl+Z`→undo，`Cmd/Ctrl+Shift+Z`/`Cmd+Y`→redo（仅 `onInlineEditCommit!=null`）。
  复用现有 keydown 处理位置，不新增冲突。

### Step 3 测试
- `use-editor-history.test.ts`：压栈/出栈/redo 清空/容量上限/resetKey 清空/undo 回填正确。
- 现有 469 个 element 测试全绿；`markdown.tsx` 相关测试重点看 undo 不破坏 memo。

### 验收
- 行内/checkbox/表格/code 语言/列表重编号均能 Cmd+Z 撤销、Shift+Cmd+Z 重做。
- undo 到 draft 层不触发自动落盘（草稿可 Revert）。
- 连续 N 步可逐步撤销/重做；撤销后新编辑清空 redo。

---

## P1-B：AST 块模型 MVP

### Step 1 新建 `frontend/app/element/markdown-transform/tree.ts`
实现 `buildBlockTree(lines: string[]): Block[]`，纯函数：
- 逐行扫描识别块类型（复用 block-type.ts 的 detectBlockKind / 正则），按顶层块分段。
- 处理代码围栏、引用嵌套、列表嵌套（depth）、表格连续行合并、callout。
- 每块产出 `{id, kind, startLine, endLine, depth, text, children}`。
- `id` 稳定：`hash(kind:startLine:endLine)` 或内容摘要（纯函数、确定性）。

### Step 2 测试
- `tree.test.ts`：标题/段落/列表/引用/代码/表格/图片/链接/分隔线/callout 各一例 + 嵌套组合例。
- 断言 startLine/endLine/depth/children 精确。

### Step 3 （可选）渲染适配器
- P1 默认不接渲染。仅当实现顺利且用户希望看到闭环时，加一个 dev-only 渲染预览（flag 关闭）。

### 验收
- `buildBlockTree` 对常见块产出精确行坐标与嵌套结构，纯函数单测通过。
- 不改任何渲染路径，469 测试全绿。

---

## 校验门
- [ ] P1-A：useEditorHistory 单测 + 469 element 全绿 + undo/redo 手工/脚本验证
- [ ] P1-B：tree.test.ts 全绿 + 469 element 全绿
- [ ] tsc 无新增错误
- [ ] 双轨并存：DOM 路径代码零改动
- [ ] 对外行为零回归

## 提交
- P1-A、P1-B 各一个 commit（或视体积合并），每次前 `pwd && git branch --show-current` 二次确认。
- 关联 task 10-05-p1-edit-core。