# Files 目录树 VCS 变动标记（D 方案：文件名着色 + 行尾 M/U/D）

## Goal

目录树每行显示 VCS 状态：文件名按变更类型着色（M橙/U绿/D红+删除线）+ 行尾字母；文件夹行尾聚合变更数；一次 RPC、两套索引、O(1)查表、缓存失效策略；原型 design/prototypes/files-vcs-tree-status

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
