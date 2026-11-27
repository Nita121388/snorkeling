---
id: N-1127-perf-w3-2-index-rework
title: "Wave 3-2: AI Sessions 索引 P1-A/P1-B/P2-A/P2-B（删重复索引+部分索引+VACUUM → -595MB、整数 session_fk sidecar、搜索流式、SaveMessages 增量）"
type: bug
priority: P1
severity: S2
status: open
origin: self
source: "HANDOFF.md W3-2 段 + .trellis/tasks/11-25-aisessions-index-perf-plan/{design.md,NEXT-STEPS.md}"
task: 11-25-aisessions-index-perf-plan
order: 100
touch: [pkg/aisessions/sqlite_index.go, pkg/aisessions/manager.go, pkg/aisessions/sqlite_index_test.go, pkg/aisessions/w3_2_index_test.go]
rollback: null
budget: {minutes: 150}
releaseCandidate: false
createdAt: "2026-11-27T01:25:16Z"
---

# Wave 3-2: AI Sessions 索引 P1-A/P1-B/P2-A/P2-B（删重复索引+部分索引+VACUUM → -595MB、整数 session_fk sidecar、搜索流式、SaveMessages 增量）

## 背景

_（待补）_

## 来源

- self：HANDOFF.md W3-2 段 + .trellis/tasks/11-25-aisessions-index-perf-plan/{design.md,NEXT-STEPS.md}

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test -p 1 ./pkg/aisessions ./pkg/service/aisessionsservice" && echo W3_2_OK` → `W3_2_OK`

## 记录

_（待补）_
