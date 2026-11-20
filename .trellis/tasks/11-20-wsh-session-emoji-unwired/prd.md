# wsh CLI 接线 bug：session emoji 命令组不可达（init() 漏 AddCommand）

## Goal

commit 2c94b2c6e 新增 session emoji 功能（后端字段/推荐注入/MCP 六工具），但 wshcmd-session.go 的 init() 注册 sessionCmd 子命令时漏了 sessionEmojiCmd，其 5 个子命令只挂在自身身上，导致整组 CLI 不可达。修法：把它加进 sessionCmd.AddCommand 列表，另补顶层回归测试锁住 sessionCmd 子命令集合。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
