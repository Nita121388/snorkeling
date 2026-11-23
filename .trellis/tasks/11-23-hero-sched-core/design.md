# Design：Hero 定时执行后端（方案 A）

## 边界

只做「调度任务 ↔ hero」的绑定与派生，不新建调度器，不碰 cron/补跑/配额。

## 改动文件清单（预估，实施时以实际为准，越界需说明）

| 文件 | 改动 |
|---|---|
| `pkg/wconfig/settingsconfig.go` | `ScheduledTaskType` + `Hero string`（omitempty）；不动既有字段语义 |
| `pkg/scheduler/*.go` | 新增 hero 派生解析（workdir/provider/model/thinking 缺省回退），在执行入口处调用一次 |
| `pkg/wshrpc/wshserver/scheduledtask.go` | `launchBlockForTask` 注入 `hero` / `hero:name` meta，`cmd:cwd` 用解析后的 workdir；headless 分支 cwd 同步 |
| `pkg/wshrpc/wshserver/scheduledtask_hero_test.go`（新） | 三个指名测试 |
| `pkg/hero/*.go` | 仅在需要暴露「按 id 取 roster 条目（含 emoji/name/provider/model）」时加只读 helper |
| `cmd/wsh/cmd/*`（按需） | scheduled task 命令透传 hero 字段 + 帮助一行 |

## 数据流

```
settings scheduledtasks:items[i].hero
        │
        ▼
resolveTaskExecution(task)  ← pkg/hero roster（hero.json: provider/model/thinking/emoji/name）
        │  规则：显式值 > hero.json > 现状默认；hero 缺失 → 现状默认 + 日志
        ▼
workdir / provider / model / thinking / heroLabel
        │
        ├─ mode=block  → launchBlockForTask：meta {hero, hero:name} + cmd:cwd=workdir
        └─ mode=headless → 进程 cwd=workdir，run 记录落 ~/.snorkeling/scheduledtask-runs/
```

## 兼容与回滚

- `hero` 为空串 → 走完全相同的旧路径（老任务调度行为与 settings JSON 字节级不变）。
- 回滚：`ScheduledTaskHeroEnabled = false` 常量或直接忽略 `Hero` 字段；无需迁移，无数据破坏。
- 不写库 schema、不动 sqlite。

## 风险

1. provider/model 默认继承可能撞 `canonicalizeModelArg` 的 profile 口径 → 必须先按现有函数规范化，再注入。
2. hero root 解析有两处口径（wconfig 设置 / pkg/hero.ResolveRoot）→ 统一到一个函数，禁止并存两份。
3. block meta 键名必须与前端常量一致（`hero` / `hero:name`），写错等于前端读不到。
