# AI 会话 origin 切换器：外部 dump 会话 + 终端式切换

## Goal

引入 origin（扫描根）抽象层，支持把其他电脑的会话 dump（如 ~/Primary/MyData/pi）作为只读来源加入 AI Sessions，左上角 icon popover 切换本机/外部，复用 filter-state-persist 持久化，外部根走 settings.json + env 配置。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
