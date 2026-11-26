---
id: N-1126-perf-w1-1-sqlite-filestore
title: "Wave 1-1: 三大 SQLite 库 WAL 调优、index-v2.sqlite schema 缓存、filestore 刷盘容错与防竞争、jobcontroller/filewatcher 减锁"
type: bug
priority: P0
severity: S2
status: open
origin: self
source: "2026-11-26T05:46:58Z"
task: 11-26-perf-w1-1-sqlite-filestore
order: 100
touch: [pkg/wstore/wstore_dbsetup.go, pkg/wstore/wstore_dbsetup_test.go, pkg/filestore/blockstore_dbsetup.go, pkg/filestore/blockstore.go, pkg/filestore/blockstore_cache.go, pkg/filestore/blockstore_perf_test.go, pkg/aisessions/sqlite_index.go, pkg/aisessions/sqlite_init_fastpath_test.go, pkg/wconfig/filewatcher.go, pkg/wconfig/filewatcher_perf_test.go, pkg/jobcontroller/jobcontroller.go, pkg/jobcontroller/jobcontroller_cache_test.go]
rollback: null
budget: {minutes: 45}
releaseCandidate: false
createdAt: "2026-11-26T05:46:58Z"
---

# Wave 1-1: 三大 SQLite 库 WAL 调优、index-v2.sqlite schema 缓存、filestore 刷盘容错与防竞争、jobcontroller/filewatcher 减锁

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test -p 1 ./pkg/wstore ./pkg/filestore ./pkg/wconfig ./pkg/jobcontroller" && echo W1_1_CORE_OK` → `W1_1_CORE_OK`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test -p 1 -run TestSQLiteIndexInitFastPath ./pkg/aisessions" && echo W1_1_AISESSIONS_OK` → `W1_1_AISESSIONS_OK`

## 记录

_（待补）_
