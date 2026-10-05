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
