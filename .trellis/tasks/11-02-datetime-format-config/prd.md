# 时间格式配置：首次安装向导 + 设置面板

## Goal

为项目引入可配置的时间/日期显示格式：settings.json 新增 app:dateformat / app:timeformat / app:relativetime 三个正交配置键，前端抽出单点 formatter 叶子模块，首次安装向导插入格式选择页（带实时预览），另提供 DateTimeSettingsModal 设置入口。收口 utils.ts / property-model.ts / aiaudit-format.ts / shadcn lib 的 5 处硬编码格式化函数。copy-context 导出的 AI 上下文文本保持 ISO 秒级不变。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
