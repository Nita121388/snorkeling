# 前端 cc-switch opencode/pi 厂商加载分支修复

## Goal

ccswitch-vendors.ts 的 loadCcSwitchVendors 只分 codex/claude 两个分支，opencode 和 pi 都落入 CcSwitchListClaudeVendorsCommand，导致 opencode 厂商下拉实际加载的是 claude 厂商、选中后注入 ANTHROPIC_* 环境变量和错误的 OPENCODE_HOME 目录。修复：opencode 分支调 CcSwitchListOpenCodeVendorsCommand，pi 分支调 CcSwitchListPiVendorsCommand（这两个 RPC 和 TS 类型都已存在）。后端物化（reader.go materializeOpenCodeConfigDir、agent-launch 的 OPENCODE_HOME 注入）本身正确，只差前端这一处分支。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
