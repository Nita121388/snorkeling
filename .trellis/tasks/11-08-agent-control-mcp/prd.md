# ACS P1+P1.5：scoped token 与 MCP 门面（外部 Agent 接入）

## Goal

让 App 外的 Agent（Claude Code / Codex / pi）通过 scoped token 走 wsh，并由 wsh mcp serve --stdio 暴露成 MCP tools/resources。含 wavejwt claims 扩展、wsh auth grant/list/revoke、--token-file、服务端 scope 强制、MCP 协议实现与 JSON Schema。设计见 design/plans/agent-control-surface.md §10.5。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
