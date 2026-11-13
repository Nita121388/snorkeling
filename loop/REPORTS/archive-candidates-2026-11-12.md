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

---

## 2026-11-13 补记（A3 完成；归档仍待 nita 确认）

| # | Trellis 任务 | loop 包 | 验收 | 提交 |
|---|---|---|---|---|
| 4 | `.trellis/tasks/11-12-persona-widget-launch/` | F-1113-persona-widget-launch-r2 | 4/5（代理验收，来源=用户本会话授权） | 91cdb4e4 |

要点：8/8 判据机器采数全绿；`PersonaRoster` RPC + `derivePersonaProps` 收口 A1.5 AC3；
🎭 浮窗 / 登场管线 / 默认 widget 已落地并写进 `docs/project/persona-system.md` §9。
已知遗留：真机 Electron 活体验证（起一次 🎭 登场看 cwd/meta/注入）待白天补跑；
「点击 → 名册 Block」「登场中状态点」「vendor 芯片」留 A4 / v2。
按批注 N-1105-cleanup-46to22，agent 不自动 archive，仍由 nita 逐个确认。

## 2026-11-13 补记（A5 完成；归档仍待 nita 确认）

| # | Trellis 任务 | loop 包 | 验收 | 提交 |
|---|---|---|---|---|
| 5 | `.trellis/tasks/11-12-persona-sync/` | F-1113-persona-sync-r1 | 4/5（代理验收，来源=用户本会话授权） | 3f9209dc |

要点：7/7 判据全绿；rootdir 单仓 + §3.2 gitignore + `persona sync` 六子命令 +
clone 后 rebuild + journal 冲突双留 + sync.mode。真机 / 真实 remote push 留用户手动。

## 2026-11-13 补记（A6 完成；归档仍待 nita 确认）

| # | Trellis 任务 | loop 包 | 验收 | 提交 |
|---|---|---|---|---|
| 6 | `.trellis/tasks/11-12-persona-journal/` | F-1113-persona-journal-r1 | 4/5（代理验收，来源=用户本会话授权） | 见 git log |

要点：7/7 判据全绿；journal 写入器 + 提议制（批准/驳回/幂等/审计）+ 蒸馏（去重/TL;DR/undo）。

## 2026-11-13 补记（A2 完成；归档仍待 nita 确认）

| # | Trellis 任务 | loop 包 | 验收 | 提交 |
|---|---|---|---|---|
| 7 | `.trellis/tasks/11-12-persona-create-ui/` | F-1113-persona-create-ui-r2 | 4/5（代理验收，来源=用户本会话授权） | 00bf0ea8 |

要点：7/7 判据全绿；`PersonaScaffoldPreview` RPC（与 A1 同源文件树）+ 两步向导 + AISessions/agent block
两处入口；Session Detail ⋯ 入口留后续。真机验证留用户手动。
