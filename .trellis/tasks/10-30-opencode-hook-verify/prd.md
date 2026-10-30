# opencode agent-status 钩子真机验证

## Goal

pkg/agentstatus/hookinstall.go 的 openCodePluginSource 假设 opencode 插件事件为 session.status / permission.*，且插件放在 <config>/plugin/*.ts 能被自动发现。本机 ~/.config/opencode/plugin 目录不存在（钩子尚未安装）。需在真机执行安装并验证：(1) 真实事件 payload 形状与 mapEvent 分支匹配；(2) 插件被 opencode 自动加载（或确认需要显式 plugin install）；(3) wsh 解析链（WAVETERM_WSHBINDIR / ~/.snorkeling/bin）可达。属于 best-effort 验证，不阻塞其他功能。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
