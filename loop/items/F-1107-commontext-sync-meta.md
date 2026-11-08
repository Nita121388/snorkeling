---
id: F-1107-commontext-sync-meta
title: "Common Text 同步元数据：createdBy/origin/rev/deletedat + 迁移 + 过滤"
type: feature
priority: P1
status: open
origin: self
source: "2026-11-07T06:05:17Z"
task: 11-07-commontext-sync-metadata
order: 100
touch: [pkg/wconfig/settingsconfig.go, pkg/commontextstore/, db/migrations-wstore/000013_commontext_sync_meta.up.sql, db/migrations-wstore/000013_commontext_sync_meta.down.sql, schema/settings.json, frontend/types/gotypes.d.ts, frontend/app/commontext/commontext-model.ts, frontend/app/commontext/commontext-model.test.ts]
rollback: null
budget: {minutes: 40, retries: 2}
releaseCandidate: false
createdAt: "2026-11-07T06:05:17Z"
---

# Common Text 同步元数据：createdBy/origin/rev/deletedat + 迁移 + 过滤

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/commontextstore/ ./pkg/wconfig/ ./pkg/agentdata/"` → `ok`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/commontextstore/ -run TestSyncColumnsExistAfterMigration -v"` → `PASS`
- [ ] `npx vitest run frontend/app/commontext` → `123 passed`

判据核心：迁移必须真的把 7 个同步列建出来（PRAGMA 是唯一可信来源），旧行读出必须是稳定兜底（human / local / rev 0）且不被回写，墓碑默认隐藏、IncludeDeleted 可见。
tsc 判据移到 check 阶段（全仓已有无关报错，grep -c 在 prove 子进程里会超时）。

## 记录

_（待补）_
