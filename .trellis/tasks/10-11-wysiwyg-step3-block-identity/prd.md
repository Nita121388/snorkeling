# 块身份 + 块级提交（data-block-id 取代行号 + 逆操作缓存）

## Goal

data-block-id 取代 data-source-line 作为块身份；提交从 replaceSourceRange(行号) 改为块级操作 + 逆操作缓存。为结构操作(阶段4)与逐类型覆盖(阶段5)打地基。依赖 step1/step2。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
