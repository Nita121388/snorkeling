# opencode 会话恢复厂商复隔离

## Goal

restoreMetaForSession 目前只给 claude 写 CLAUDE_CONFIG_DIR，opencode/pi 的 configdir 分支缺失，导致结构化恢复（非命令串路径）不重新隔离到原厂商；restoreCommandForSession 虽会注入 OPENCODE_HOME，但前提是 summary.configdir 非空，而 provider_opencode 从不填 ConfigDir（只有 provider_claude 通过 ResolveClaudeVendorSessionPath 填）。需做两处：(1) provider_opencode 解析 cc-switch vendor 目录并填 ConfigDir；(2) restoreMetaForSession 加 opencode/pi 分支写入对应环境变量。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
