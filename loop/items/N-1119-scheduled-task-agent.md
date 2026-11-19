---
id: N-1119-scheduled-task-agent
title: "定时任务 agent 化：CLI/MCP 创建 + headless/建块双模式 + 启动补跑"
type: feature
priority: P1
severity: S3
status: open
origin: self
source: "nita 2026-11-19：agent 创建定时任务；任务可选建 agent Block（agent/Tab/路径）；agent 建块可选不建前端 Block；Snorkeling 未运行也要能执行（拍板走 catch-up）"
task: 11-19-scheduled-task-agent
order: 140
touch: [pkg/scheduler/**, pkg/wconfig/settingsconfig.go, pkg/wshrpc/wshrpctypes.go, pkg/wshrpc/wshclient/wshclient.go, pkg/wshrpc/wshserver/scheduledtask.go, pkg/wshrpc/wshserver/agentlaunch.go, pkg/agentmcp/**, cmd/wsh/cmd/wshcmd-scheduledtask.go, cmd/wsh/cmd/wshcmd-agent-launch.go, frontend/types/gotypes.d.ts, frontend/app/store/wshclientapi.ts, .trellis/tasks/11-19-scheduled-task-agent/**]
rollback: "新增 CLI/MCP 与 mode 字段默认 headless（旧任务行为不变）；catch-up 可用常量开关关闭；revert 即回到纯 InProcess 行为"
budget: {minutes: 300, retries: 2}
releaseCandidate: true
createdAt: "2026-11-19T14:30:00Z"
---

# 定时任务 agent 化

## 背景

地基已有（InProcessScheduler + headless runner + CRUD RPC + 前端 modal），缺 CLI/MCP、缺建块模式、缺 catch-up。
nita 拍板：第 4 条走 C 档（启动补跑），mode 二分默认 headless，「不建前端 Block」=完全不吃块，写类默认 dry-run + 配额 10。

## 验收判据

- [ ] `go build ./...` 0 错；`go test ./pkg/scheduler/... ./cmd/wsh/cmd/... ./pkg/agentmcp/...` 全绿
- [ ] `./wsh scheduledtask list --json` 可用；create 默认 dry-run；`--yes` 才落库；第 11 个 agent 任务 E_QUOTA
- [ ] headless 任务 run 后 db_block 行数不变且有日志；block 任务 run 后 db_block +1 且 meta 含 agent:provider
- [ ] `agent launch --headless` 不建块、返回 exitcode/outputPath；与 --tab 互斥 E_USAGE
- [ ] catch-up 单测：错过 10m 间隔 → 启动补跑一次且 LastRunStatus=missed-run，不重复
- [ ] 生成物只增不改（无字段大小写/类型块顺序漂移）

## 记录

- 门状态：G6 方案 = 任务 prd.md；G2 器具 = 上面六条。引擎在 Windows 侧，凭据待代录。
