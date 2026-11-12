# 待确认归档清单 — 2026-11-12（agent 生成，nita 逐个过）

> 依据批注 N-1105-cleanup-46to22：agent 不得自动 archive，只生成待确认清单。
> 下列任务「实现+判据+验收」均已闭环；**归档动作待 nita 确认**。

| # | Trellis 任务 | loop 包 | 验收 | 提交 |
|---|---|---|---|---|
| 1 | `.trellis/tasks/11-12-persona-core/` | F-1112-persona-core-r2 | 4/5 | ee2ae660 |
| 2 | `.trellis/tasks/11-12-persona-aisessions/` | F-1112-persona-aisessions-r1 | 4/5 | 见 A1.5 提交 |
| 3 | `.trellis/tasks/11-12-persona-agent-create/` | F-1112-persona-agent-create | 4/5 | 见 A2.5 提交 |

## 逐条确认要点

1. **11-12-persona-core**：`pkg/persona` + `wsh persona create/list/get/rename`。已知遗留：
   `persona:<id>` block meta 重写是 A3 钩子（当前恒 0）；data scope 强制点在 A2.5（已补 guide）。
2. **11-12-persona-aisessions**：🎭 分组折叠 + 行标 + 客户端筛选。已知遗留：AC3
   （`props.persona` 非空）需活体 app，A3 登场管线才会自动写，未做活体验证。
3. **11-12-persona-agent-create**：propose 闸门 + 配额 + memory 纪律 + guide 注册。
   5 处偏离已披露（见实现汇报）；`--from-session this` 的 RPC 解析未在活体 app 验证。

确认方式（任选）：`python3 .trellis/scripts/task.py archive <dir>`，或说「归档 1、2」由我执行。
