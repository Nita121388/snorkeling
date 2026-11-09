---
id: F-1109-commontext-sync-watermark
title: "Common Text 条目级同步水位：区分已同步/待上传 + 增量推送 + 墓碑"
type: arch
priority: P1
status: open
origin: self
source: "2026-11-09T02:03:02Z"
task: 11-09-commontext-sync-watermark
order: 100
touch: [pkg/wconfig/settingsconfig.go, pkg/commontextstore/**, pkg/sync/**, pkg/syncproto/**, pkg/syncmanager/**, pkg/service/commontextservice/**, cmd/wsh/cmd/wshcmd-commontext-sync.go, cmd/snorkeling-sync/store.go, db/migrations-wstore/000014_commontext_sync_watermark.*, frontend/app/commontext/**, frontend/types/gotypes.d.ts, schema/settings.json, scripts/check-tsc-baseline.mjs, docs/project/verify-ledger.md, .trellis/tasks/11-09-commontext-sync-watermark/**, .trellis/spec/**]
rollback: "git revert 单提交；迁移 000014 down 只 DROP 新表，主表未改"
budget: {minutes: 150, retries: 2}
releaseCandidate: false
createdAt: "2026-11-09T02:03:02Z"
---

# Common Text 条目级同步水位：区分已同步/待上传 + 增量推送 + 墓碑

## 背景

CommonText 无法区分哪些条目已上传：db_common_text 无水位列，本地编辑不 bump rev（commontext-model.ts:655），引擎每轮全表推（engine.go:317），Status 只有四个全局计数。UI 删除不写墓碑（commontext-model.ts:672-676），删除推不出去会被对端复活。

## 来源

- self：（待补）

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/commontextstore/ ./pkg/sync/ ./pkg/syncmanager/ ./pkg/syncproto/ ./pkg/syncjournal/ ./pkg/syncconflict/; if ($LASTEXITCODE -eq 0) { 'GO_SUITE_OK' }"` → `GO_SUITE_OK`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/commontextstore/ -run TestSyncWatermark; if ($LASTEXITCODE -eq 0) { 'GO_WATERMARK_OK' }"` → `GO_WATERMARK_OK`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/sync/ -run TestEngineWatermark; if ($LASTEXITCODE -eq 0) { 'GO_ENGINE_WATERMARK_OK' }"` → `GO_ENGINE_WATERMARK_OK`
- [ ] `npx vitest run frontend/app/commontext --reporter=dot >nul 2>&1 && echo CT_TESTS_OK` → `CT_TESTS_OK`
- [ ] `node scripts/check-tsc-baseline.mjs && echo TSC_BASELINE_OK` → `TSC_BASELINE_OK`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go vet ./pkg/commontextstore ./pkg/sync ./pkg/syncmanager ./pkg/syncproto; if ($LASTEXITCODE -eq 0) { 'GO_VET_OK' }"` → `GO_VET_OK`

## 记录

_（待补）_
