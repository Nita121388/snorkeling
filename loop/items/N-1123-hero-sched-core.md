---
id: N-1123-hero-sched-core
title: "Hero 定时执行后端（方案 A）：ScheduledTaskType 加 hero 字段 + hero home cwd + block meta 注入"
type: arch
priority: P1
status: open
origin: self
source: "nita 2026-11-23 15:11 布置、当晚拍板方案 A：复用 ScheduledTask 系统 + 加 hero 字段，默认 mode=block"
task: 11-23-hero-sched-core
order: 100
touch: [pkg/wconfig/settingsconfig.go, pkg/scheduler/**, pkg/wshrpc/wshserver/**, pkg/hero/**, cmd/wsh/cmd/**, docs/project/**, loop/red/**, .trellis/**]
rollback: null
budget: {minutes: 300, retries: 2}
releaseCandidate: false
createdAt: "2026-11-23T11:16:20Z"
---

# Hero 定时执行后端（方案 A）：ScheduledTaskType 加 hero 字段 + hero home cwd + block meta 注入

## 背景

锚点：pkg/wconfig/settingsconfig.go ScheduledTaskType（AgentProfile/Provider/Model/Workdir/Mode）· pkg/wshrpc/wshserver/scheduledtask.go launchBlockForTask（AgentLaunchRequest 目前不传 hero meta）· pkg/hero roster/ValidateID（hero.json provider/model）· 前端镜像语义见 frontend/app/workspace/hero-launch.ts（meta hero / hero:name、cwd=hero home）

## 来源

- self：nita 2026-11-23 15:11 布置、当晚拍板方案 A：复用 ScheduledTask 系统 + 加 hero 字段，默认 mode=block

## 验收判据

- [ ] `go build ./... >/dev/null 2>&1 && echo GO_BUILD_OK` → `GO_BUILD_OK`
- [ ] `go test -count=1 ./pkg/scheduler/... ./pkg/wshrpc/wshserver/... ./pkg/wconfig/... ./pkg/hero/... >/dev/null 2>&1 && echo GO_TESTS_OK` → `GO_TESTS_OK`
- [ ] `go test -count=1 -run Hero -v ./pkg/scheduler/... ./pkg/wshrpc/wshserver/... ./pkg/wconfig/... 2>&1 | grep -c -- "--- PASS"` → `3`

## 记录

_（待补）_
