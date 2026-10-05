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
