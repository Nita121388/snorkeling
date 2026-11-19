# 定时任务 + Agent Block：agent 可创建、可选建块/不建块、没运行时补跑

## Goal

让定时任务成为 agent 可编程的能力：外部 agent 用一条命令把「到点让某个 agent 干活」排进去；
任务既能**建一个可见的 agent Block**（选 agent / Tab / 路径），也能**只跑不建块**（headless）；
Snorkeling 没运行时错过的任务，**下次启动补跑**，不静默丢。

## 背景（已确认事实）

已有地基（比预期完整）：

- `pkg/scheduler`：`InProcessScheduler`（timer 驱动，**仅 wavesrv 运行期间有效**）+ `cronexpr.go`（cron 解析）
  + `runner.go`（headless 执行器：pi/codex/claude/gemini/opencode 的 one-shot 参数**已适配**，
  `cmd.Dir=Workdir`、继承 `os.Environ()`、30 分钟超时）+ `store.go`（RunStore 内存记录）
- `wconfig.ScheduledTaskType`：agentProfile / model / thinking / prompt / workdir / connection /
  schedule(cron|interval|once|daily|weekly) / 通知 / LastRun* / **CreatedBy（已预埋）**
- RPC：`ScheduledTaskList/Get/Create/Update/Delete`（`pkg/wshrpc/wshserver/scheduledtask.go`），
  启动点在 `cmd/server/main-server.go:658` → `InitScheduledTasks()`
- 前端编辑弹窗：`modals/scheduledtaskeditormodal.tsx`

缺口：

1. **没有 CLI / MCP**：外部 agent 无法创建定时任务（只有 RPC 和 UI 弹窗）
2. **只能 headless，不能建块**：`runner.go` 只 exec CLI，`ScheduledTaskType` 没有 mode / tab 字段
3. **`wsh agent launch` 必然建块**：没有「跑一次但不建块」的入口
4. **app 不运行时任务不跑**：`InProcessScheduler` 随 wavesrv 生命周期；错过即丢，无 catch-up

## 已定决策（2026-11-19，nita 拍板「ok go on」= 采纳以下推荐）

| # | 决策 | 含义 |
|---|---|---|
| 1 | **第 4 条先做 C 档：启动补跑（catch-up）** | app 启动时扫描"错过执行时间"的 enabled 任务，立即补跑一次并标记 `LastRunStatus=missed-run`。不做 OS 级准点调度（launchd/Task Scheduler）与常驻 helper——那是 P3，等确有"半夜准点"需求再做 |
| 2 | **任务二分模式 `mode: headless \| block`，默认 `headless`** | `headless` = 跑一次 CLI 到日志，不建块；`block` = 在指定 Tab 建 agent Block 并投递 prompt |
| 3 | **「不创建前端 Block」= ①完全不建块**（不是"建块但不渲染"） | 与 runner 现有 headless 路径一致；`--headless` 语义同此 |
| 4 | **安全门控**：写类默认 dry-run；`--yes` 才真写；任务数配额 ≤10/agent（E_QUOTA）；UI/CLI 都显示 `createdBy` | agent 能定时执行任意 prompt = 高危能力，必须有闸门与可审计 |

## Requirements

### R1 CLI：`wsh scheduledtask`（新增命令组）

```
wsh scheduledtask list   [--json] [--created-by agent|user]
wsh scheduledtask get    <id> [--json]
wsh scheduledtask create --name <n> --prompt <p> --schedule '<spec>' [--mode headless|block]
                         [--agent <profile>] [--model <m>] [--workdir <dir>] [--tab current|new|<tabid>]
                         [--dry-run(默认)] [--yes]
wsh scheduledtask update <id> [--enabled=false] ... [--dry-run(默认)] [--yes]
wsh scheduledtask delete <id> [--yes]
wsh scheduledtask run    <id> [--json]        # 立即跑一次（验证用）
```

- 调 RPC 的既有 handler；`--dry-run` 默认开（与 `agent card set` 同风格），`--yes` 才落库/真跑
- `create` 时 `createdBy` 取调用方身份：外部 agent → `agent`；无 self 上下文 → `user`
- `--schedule` 支持 `cron:<expr>` / `every:<n>s|m|h` / `once@<ISO>` / `daily@HH:MM` / `weekly@<0-6>@HH:MM`

### R2 MCP 三工具（`pkg/agentmcp/tools.go`）

- `snorkeling_scheduledtask_list` / `snorkeling_scheduledtask_create` / `snorkeling_scheduledtask_run`
- 与 CLI 同 handler；写类默认 dry-run；错误码复用 `E_USAGE` / `E_NOT_FOUND` / `E_QUOTA`

### R3 任务模式与建块

- `ScheduledTaskType` 新增：`Mode string`（`""|headless|block`，空按 headless）、`Tab string`（`current|new|<tabid>`，仅 block 有效）
- `runner.RunTask`：`mode=headless` 走现有 exec 路径；`mode=block` 调 `AgentLaunchCommand`
  （等价 `wsh agent launch --profile <p> --model <m> --cwd <workdir> --tab <tab|active> --send <prompt>`），
  **失败不得留下半初始化块**（校验失败要回滚/不建）
- 结果统一落 `RunStore` + `LastRunStatus` / `LastRunAt` / `RunCount`

### R4 `wsh agent launch --headless`

- 不建块：直接以 one-shot 方式跑该 profile（复用 `runner.headlessArgs` 的同一映射，避免两套参数表），
  输出写 `~/.snorkeling/scheduledtask-runs/<taskid|adhoc>-<ts>.log`
- 返回 `exitcode` / `outputPath` / `durationMs`；非零退出 → 结构化错误（`E_AGENT_FAILED`），CLI exit 1
- `--headless` 与 `--tab` 互斥（同时给 → `E_USAGE`）

### R5 启动补跑（catch-up，决策 #1）

- `InitScheduledTasks()` 启动时：对每个 enabled 任务计算 `nextRunAfter(lastRunAt)`；
  若「上次应跑时间 ≤ 现在」且 `lastRunAt < 上次应跑时间` → 记 `missed` 并**串行**补跑一次（不并发、不重复触发）
- 补跑同样受 `mode` 分支与 30 分钟超时约束；补跑结果 `LastRunStatus=missed-run`（与正常 `success` 区分）
- 同一任务补跑只做一次（用 `lastRunAt` 推进防重复）；不做「补跑多次」

### R6 配额与审计

- 每个 `createdBy=agent` 的调用方最多 10 个任务（`E_QUOTA`，消息含当前数/上限/hint）
- 所有写操作走既有 RPC 层，`LastRunStatus` 可查；CLI `list --json` 带 `createdBy` / `mode` / `lastRunStatus`

### R7 生成物

- 改 `wshrpctypes.go` 后必须 `node scripts/run-task.mjs generate` 刷新
  `pkg/wshrpc/wshclient/wshclient.go`、`frontend/types/gotypes.d.ts`、`frontend/app/store/wshclientapi.ts`
- **只允许新增行**；出现删除、字段大小写变化、类型块顺序互换（今天已踩：`syncproto.Origin` 与 `hero.Origin`
  被生成器写反）→ 立即停下报告，不要提交坏生成物

## Acceptance Criteria

| # | 判据 | 命令 → 期望 |
|---|---|---|
| A1 | 编译 | `go build ./...` → 0 错 |
| A2 | Go 测试 | `go test ./pkg/scheduler/... ./cmd/wsh/cmd/... ./pkg/agentmcp/...` → 全绿 |
| A3 | CLI 存在 | `./wsh scheduledtask list --json` → 合法 JSON；`--help` 含 create/run |
| A4 | 默认 dry-run | `./wsh scheduledtask create ...`（不带 --yes）→ 输出预览、**settings 里任务数不变** |
| A5 | 配额 | 造 10 个 `createdBy=agent` 任务后再 create → `E_QUOTA`，exit 1 |
| A6 | headless 不建块 | 建 `mode=headless` 任务 → `scheduledtask run <id>` → **db_block 行数不变**，日志文件存在且含输出 |
| A7 | block 建块 | 建 `mode=block --tab new` 任务 → `run <id>` → **db_block 行数 +1**，新块 meta 含 `agent:provider` 与 `cmd:cwd` |
| A8 | launch --headless | `./wsh agent launch --profile pi --headless --send "test"` → 不建块、返回 exitcode 与 outputPath；与 `--tab` 同时给 → `E_USAGE` |
| A9 | catch-up | 单测：任务 `lastRunAt` 设为一小时前、schedule=every:10m → `InitScheduledTasks` 后跑一次且 `LastRunStatus=missed-run`；再启动不重复跑 |
| A10 | 生成物干净 | `git diff --stat` 里三个生成文件只有新增行；`git diff` 无删除行 |

## 白名单（只允许改/新增）

`pkg/scheduler/**`、`pkg/wconfig/settingsconfig.go`、`pkg/wshrpc/wshrpctypes.go`、
`pkg/wshrpc/wshclient/wshclient.go`（生成物）、`pkg/wshrpc/wshserver/scheduledtask.go`、
`pkg/wshrpc/wshserver/agentlaunch.go`（如需 headless 分支）、`pkg/agentmcp/tools.go`、`pkg/agentmcp/server_test.go`、
`cmd/wsh/cmd/wshcmd-scheduledtask.go`（新建）、`cmd/wsh/cmd/wshcmd-agent-launch.go`、
`cmd/wsh/cmd/*_test.go`（本包新增）、`frontend/types/gotypes.d.ts`（生成物）、
`frontend/app/store/wshclientapi.ts`（生成物）、`.trellis/tasks/11-19-scheduled-task-agent/**`

## 明确不做（本包）

- OS 级准点调度（launchd / Windows Task Scheduler）与常驻 helper（P3）
- 远程 connection 上的定时任务执行（本包 local-only；`connection` 字段保留不实现）
- 前端编辑弹窗重做（现有 modal 继续可用；只补 mode/tab 字段的最小联动如超范围则留 TODO）
- 定时任务的并发执行池（串行即可）

## Notes

- 分期间关系：P0（CLI+MCP 门控）→ P1（mode/tab + 建块 + launch --headless）→ P2（catch-up）。
  P0 完成即可先跑 A3/A4/A5；P1 完成跑 A6/A7/A8；P2 完成跑 A9。
- `runner.headlessArgs` 是唯一的 one-shot 参数映射表，`agent launch --headless` 必须复用它（不得第二份映射）。
- 建块路径必须复用 `AgentLaunchCommand`（目录校验 + provider/model 展开 + meta 对齐 GUI 的契约见
  `.trellis/spec/snorkeling-docs/backend/agent-control-surface-contract.md` §11）。
