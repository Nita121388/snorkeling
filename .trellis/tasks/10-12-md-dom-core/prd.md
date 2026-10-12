# md-dom：框架无关的编辑引擎（复用关键层）

## Goal

把 markdown-inline-edit.tsx 里框架无关的编辑引擎抽成 DOM 版（就地编辑、overlay 生命周期、caret/选区、键盘语义、块级提交），使非框架消费者（如 ~/Primary/projects/journal，纯 ESM Chrome 扩展）可以只用 md-core + md-dom 渲染并编辑 markdown；React 侧退化为薄绑定。验收：Snorkeling 行为零回归 + journal 侧真实跑通。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
