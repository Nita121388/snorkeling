# Wave 2-1b: 入口 chunk 布局——monaco/shiki 脱离入口静态闭包（31.52MB → 10.62MB）

## Goal

实测入口静态闭包 31.52MB：aifilediff/vcsdiff 为拿 30 行 getFileLanguage 静态引 preview-edit（内含 monaco-editor）→ monaco 7.78MB 进每个 Tab 入口；vite preload-helper 落进 monaco chunk；manualChunks 把已是动态 import 的 mermaid/cytoscape/katex 强制分组后被入口整包 bare-import。治理后入口静态闭包 10.62MB（-66%）。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
