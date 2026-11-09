# 实施计划：Common Text 条目级同步水位

> 顺序按「先让判定存在，再让引擎用它，最后让 UI 看得见」，每步都能独立跑测试。
> 每步末尾的 `验证` 是 bring-up 判据，不通过不进下一步。

## S0 器具（先红后绿）

1. 新增 Go 用例（此时必红）：
   - `pkg/commontextstore/commontext_sync_watermark_test.go`
     - `TestSyncWatermarkLifecycle`：保存 → 无水位行 → `syncstate=pending`；`MarkSynced` → `synced`；
       再改 `updatedat` → 变回 `pending`。
     - `TestSyncWatermarkSurvivesFullTableSave`：`MarkSynced` 后走整表 `SaveFromConfigMap`（模拟 UI 保存）
       → 水位不丢（D1 的回归钉子）。
     - `TestTombstoneReadsBackAsPending`：写入 `deletedat` 条目 → `IncludeDeleted` 可见且 pending，
       默认 `List` 不可见。
     - `TestPendingItemsExcludesSynced`：`PendingItems()` 只返回未同步的。
   - `pkg/sync/engine_watermark_test.go`
     - `TestEnginePushesOnlyPending`：假 store 的 `PendingItems` 返回 1 条 →
       transport 只收到 1 条，`MarkSynced` 收到该 id。
     - `TestEngineBaselineStillPushesAll`：`RunWithBaseline(local)` → transport 收到全量。
     - `TestEngineRemoteResetRepushesAll`：`remote.Rev < MaxSyncedRev()` → 清水位 + 全量推。
     - `TestEngineMarkSyncedFromPushOutcome`：conflict 条目不写水位，applied/unchanged 写。
2. 验证：`go test ./pkg/commontextstore/ -run TestSyncWatermark` → 编译失败或不通过（红）。

## S1 存储层

1. `db/migrations-wstore/000014_commontext_sync_watermark.{up,down}.sql`（D1 的 SQL）。
2. `pkg/wconfig/settingsconfig.go`：`CommonTextItemType` 加
   `SyncedRev float64 json:"syncedrev,omitempty"`、`SyncedAt float64 json:"syncedat,omitempty"`、
   `SyncState string json:"syncstate,omitempty"`（只读投影）。
3. `pkg/commontextstore/commontext_store.go`：
   - `commonTextSyncRow` + `commonTextRowColumns` 保持不变，另开 `loadSyncWatermarks()`（`SELECT * FROM db_common_text_sync`）。
   - `commonTextItemFromRow(row, wm)` 投影 `syncedrev/syncedat/syncstate`。
   - 导出 `SyncStatePending = "pending"` / `SyncStateSynced = "synced"`，`SyncStateOf()`。
   - `MarkSynced(ctx, []syncproto.PushItemResult)`：upsert 水位行
     （`syncedrev = result.Rev`，`syncedupdatedat = 该条目当前 updatedat`，`syncedat = now`）。
   - `PendingItems(ctx)`：`List(IncludeDeleted)` 后按 `SyncStateOf` 过滤。
   - `ResetSyncWatermarks(ctx)` / `MaxSyncedRev(ctx)`。
   - `SaveAll` / `saveCommonTextItemsToDB` 顺手清理孤儿水位行
     （`DELETE FROM db_common_text_sync WHERE id NOT IN (SELECT id FROM db_common_text)` 里
     但**只清「既不在主表也不在墓碑」**——墓碑仍在主表，因此自然保留）。
4. 验证：`go test ./pkg/commontextstore/` 绿；`go test ./pkg/wconfig/` 绿。

## S2 协议 + 引擎

1. `pkg/syncproto/syncproto.go`：`PushItemResult` / `PushResponse.Items` / 状态常量
   （`PushStatusApplied / Unchanged / Conflict`）。
2. `pkg/sync/engine.go`：
   - `PushOutcome.Items []syncproto.PushItemResult`。
   - `Store` 接口加 `PendingItems` / `MarkSynced`（另加内部可选接口 `MaxSyncedRev` /
     `ResetSyncWatermarks`，用类型断言避免把可选能力塞进主接口）。
   - `runOnce`：稳态用 `PendingItems`；baseline 用 `Items`；pull 后做远端重置自愈；
     push 后 `MarkSynced` 过滤 conflict。
   - `RunResult` 加 `PushedIds []string`、`Pending int`（供 status 与 CLI）。
3. `pkg/sync/transport_folder.go`、`transport_git.go`：每条分支填 `outcome.Items`
   （applied / unchanged / conflict 三处）。
4. `pkg/sync/transport_server.go`：透传 `res.Items`。
5. `cmd/snorkeling-sync/store.go`：`Apply` 填 `resp.Items`（insert / tombstone / newer / unchanged / conflict 五条分支）。
6. 验证：`go test ./pkg/sync/ ./pkg/syncproto/ ./pkg/syncmanager/` 绿。

## S3 接线（status / RPC / CLI）

1. `pkg/syncmanager/syncmanager.go`：
   - `storeAdapter.PendingItems` / `MarkSynced` / `MaxSyncedRev` / `ResetSyncWatermarks`。
   - `Status.Pending int`；`currentStatusLocked()` 读 `commontextstore` 数 pending。
   - 每轮 run 收尾（成功或失败都）调 `wconfig.BroadcastConfigUpdate()`，让前端 item 列表刷新。
2. `pkg/service/commontextservice/commontextservice.go`：`CommonTextSyncPending` /
   `CommonTextSyncMarkSynced` 两个 RPC + `_Meta`。
3. `cmd/wsh/cmd/wshcmd-commontext-sync.go`：
   - `pending [--json]` 子命令（默认表格：`id\ttitle\tupdated`）。
   - `cliSyncStore` 实现 `PendingItems` / `MarkSynced`（走上面两条 RPC）。
   - `show --json` 输出里带 `pending` 计数。
4. `task generate` 重生成 `frontend/types/gotypes.d.ts` + `schema/settings.json`。
5. 验证：`go vet` 四个包无输出；`node scripts/check-tsc-baseline.mjs` → `TSC_BASELINE_OK`。

## S4 前端

1. `frontend/app/commontext/commontext-model.ts`：
   - `CommonTextItem` 加 `syncstate?: "pending" | "synced"` + `syncedrev?: number`；normalize 读它。
   - `getCommonTextItemsFromSettings` 过滤 `deletedat > 0`（墓碑不上列表）。
   - `deleteCommonTextItem` → 写墓碑（`deletedat = updatedat = now`），不删数组项。
   - `upsertCommonTextItem` 不动 `syncstate`（只读投影，保存时忽略）。
2. `frontend/app/commontext/commontext-compose-modal.tsx`：
   - 列表行标题后 `data-commontext-sync-state={item.syncstate}` 圆点（pending 才渲染，`bg-warn` + tooltip）。
   - 详情页脚 meta 区加 `data-commontext-detail-sync` 一项：`Pending upload` / `Synced · rev N`。
3. 用例 `frontend/app/commontext/commontext-model.test.ts` 追加：
   - 墓碑过滤、删除写墓碑、syncstate 归一、保存不携带 syncstate。
4. `commontext-compose-modal.test.ts` 追加源码断言（与既有风格一致，不引 DOM 测试框架）。
5. 验证：`npx vitest run frontend/app/commontext` 全绿。

## S5 收尾

1. 逐条跑 `prd.md` 的 7 条判据（`node E:/primary/projects/loop/queue.mjs prove --id F-1109-commontext-sync-watermark`）。
2. `docs/project/verify-ledger.md` 记一行结论（含 skipped 两项）。
3. `.trellis/spec/` 回写一条契约：**「整表覆盖的写路径不许承载同步状态」**（D1 的通用化）。
4. commit（单提交，含迁移 + 代码 + 测试 + 文档）。

## 回滚点

- S1 后：迁移可 down（只 DROP 新表）。
- S2 后：引擎仍是「全量推 + 回写水位」，回滚只需撤 `PushOutcome.Items` 的消费方。
- S4 后：UI 是新字段的纯投影，回滚无数据影响。
