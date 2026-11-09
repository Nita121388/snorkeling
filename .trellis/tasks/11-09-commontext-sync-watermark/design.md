# 设计：Common Text 条目级同步水位

## 核心决定（D1–D5）

### D1 水位放独立表 `db_common_text_sync`，不给 `db_common_text` 加列

`commontext:items` 的写路径是「前端整表覆盖」：

```
React 编辑器 → SetConfigCommand(commontext:items=[全部条目])
             → SaveFromConfigMap → saveCommonTextItemsToDB（整表 upsert + 删除不再出现的 id）
```

前端手里那份数组是**同步前**读到的快照。若水位列长在 `db_common_text` 上，任何一次 UI 保存
（改标题、点置顶、记一次使用）都会把该行的水位写回旧值 —— 同步刚确认的水位被自己冲掉，
表现成「同步后过一会儿又变回待上传」。这不是理论风险：`rev` 今天就靠
`commontext-model.ts:655` 的 `rev: existing?.rev ?? 0` 手工续命才没被冲。

独立表不在整表覆盖的写路径上，天然免疫；读路径 `LEFT JOIN` 后投影到 item 上。

```sql
-- 000014_commontext_sync_watermark.up.sql
CREATE TABLE IF NOT EXISTS db_common_text_sync (
    id              text PRIMARY KEY,
    syncedrev       real NOT NULL DEFAULT 0,  -- 远端确认过的该条目 rev
    syncedupdatedat real NOT NULL DEFAULT 0,  -- 确认时该条目的 updatedat（判定 pending 的唯一依据）
    syncedat        real NOT NULL DEFAULT 0   -- 确认发生的本地时刻（只用于展示/排障）
);
CREATE INDEX IF NOT EXISTS idx_common_text_sync_syncedat ON db_common_text_sync (syncedat);
```

down 迁移：`DROP TABLE db_common_text_sync;`（不动主表，可安全回滚）。

### D2 pending 判定 = 比较 updatedat，不比 rev、不比时钟

```go
// 唯一判定函数：引擎、CLI、UI 都读它，不许各自算。
func SyncStateOf(item commonTextItem, wm *commonTextSyncRow) string {
    if wm == nil { return SyncStatePending }            // 从未同步过
    if item.UpdatedAt > wm.SyncedUpdatedAt { return SyncStatePending }  // 改过，但没推上去
    return SyncStateSynced
}
```

为什么用 `updatedat` 而不是 rev：
- 本地编辑不改 rev（web 前端不知道远端 rev 规则），所以 `rev` 无法标记 dirty。
- `updatedat` 是**条目自带的一个标量**，本地编辑时由同一处代码写（`commontext-model.ts:647`），
  从远端拉下来时原样保留。所以「同一个时钟口径的两个值比较」成立。
- 不写 `syncedat = 本地 now`：远端条目的 `updatedat` 可能是另一台机器的时钟（可能比本机快），
  拿本地 now 当水位会让它以「永远 pending」的形式假报。水位必须记录**被确认的那份
  updatedat 原值**，而不是确认时刻。

远端条目落库时（`ApplyRemoteWithMode`）同步写水位：`syncedupdatedat = incoming.UpdatedAt`、
`syncedrev = incoming.Rev` —— 刚拉下来的东西当然已同步。

### D3 三路 transport 与 server 都要报**条目级**结果

今天 `PushOutcome` 只有 `Applied/Unchanged` 两个计数，引擎即使想回写也不知道哪条成功。新增：

```go
// syncproto
type PushItemResult struct {
    Id     string  `json:"id"`
    Rev    float64 `json:"rev,omitempty"`
    Status string  `json:"status"` // applied | unchanged | conflict
}
type PushResponse struct { ... ; Items []PushItemResult `json:"items,omitempty"` }
```

`pkg/sync.PushOutcome` 同名字段承载 transport 产出的结果；`transport_server` 直接把
server 的 `PushResponse.Items` 透传（server 端 `cmd/snorkeling-sync/store.go` 的 `Apply` 逐条填）。

冲突条目不写水位（双方不一致，必须等解决）。这是「已同步」语义的诚实边界：
**说 synced 的意思是「远端已经和本地这份内容一致」**，冲突不满足。

### D4 `Store` 接口扩展两个方法，引擎不直接碰数据库

```go
type Store interface {
    Items(ctx) ([]SnapshotItem, error)          // 全量（含墓碑），baseline 用
    PendingItems(ctx) ([]SnapshotItem, error)   // 只需要上传的（含待删墓碑）
    MarkSynced(ctx, results []PushItemResult) error
    ApplyRemoteWithMode(ctx, items, mode) (int, error)  // 内部顺带写水位
    LocalRevision(ctx) (float64, error)
}
```

`syncmanager.storeAdapter` 走 `commontextstore`；`cmd/wsh` 的 `cliSyncStore` 走两条新 RPC
（`CommonTextSyncPending` / `CommonTextSyncMarkSynced`），保证 CLI 跑一轮也会推进水位，而不是
让 GUI 那边永远显示 pending。

### D5 远端被重置的自愈（否则新机制引入静默丢推）

一旦「只推 pending」，就新增一个以前不存在的失效模式：远端文件被删/被换成空目录时，
`Pull(sinceRev)` 拿不到任何东西，push 又被水位挡住 → 本地条目永远不上传，且没有任何报错。

护栏：pull 之后比较 `remote.Rev < store.MaxSyncedRev()` → 判为「远端从零开始」，
`store.ResetSyncWatermarks()` 清水位后本轮全量推。代价是一次多余的整包推，收益是「换目录 /
重装对端」不再需要手工 re-sync。

## 数据流（一轮稳态 sync）

```
Pull(sinceRev = 本地最大 rev)
  ├─ 有条目 → ApplyRemoteWithMode（remote.Rev > local.Rev 才覆盖）
  │            └─ 逐条写水位：syncedupdatedat = incoming.UpdatedAt
  └─ 判 remote.Rev < MaxSyncedRev() → ResetSyncWatermarks()（自愈）

PendingItems()  ← LEFT JOIN 水位，updatedat > syncedupdatedat 或无水位行
  └─ 为空 → 本轮 push 跳过（journal 只记 run_end）

Push(items = pending, BaseRev = localRev)
  └─ PushOutcome.Items[] → MarkSynced(non-conflict 条目)

Cost：syncmanager 收尾 → wconfig.BroadcastConfigUpdate()
      → 前端 settingsAtom 更新 → 列表 syncstate 立刻刷新（不用重开弹窗）
```

## 前端

- `CommonTextItem` 加 `syncstate?: "pending" | "synced"`（**只读投影**，不参与保存：
  `upsertCommonTextItem` 不写它，写路径也不带 —— 它由后端 JOIN 得出）。
- 列表行：标题后 `data-commontext-sync-state` 圆点，只在 pending 出现（`bg-warn`），
  tooltip 说明「Not uploaded yet — next sync will send it」。
- 详情页脚 meta 区加一项 `Sync`：`Pending upload` / `Synced · rev N`。
- 墓碑：`getCommonTextItems` 过滤 `deletedat > 0`；`deleteCommonTextItem` 不再 filter，
  而是把 `deletedat + updatedat` 写成 now 并保留条目（否则推不出去）。

## 兼容与回滚

- 老数据：没有水位行 → 全部 pending → 第一次同步整包推一遍（与今天行为一致），之后转增量。
- 回滚：`git revert` 单提交；迁移 down 只 DROP 新表，主表未变，回滚后旧代码照常跑（水位信息丢失，
  下次同步会重新整包推一次）。
- `schema/settings.json` / `frontend/types/gotypes.d.ts` 由 `task generate` 重生成，不手改。

## 风险

| 风险 | 处置 |
|---|---|
| `updatedat` 同毫秒写入导致 pending 判不出 | 编辑路径本就 `Date.now()`；同一毫秒内再改出同样的 updatedat 概率极低，且后果只是「少推一次」，下一次编辑会补上 |
| `MarkSynced` 写失败导致永久 pending | 写库失败 → 本轮 run 返回错误并清空 `lastRunAt` 成功标记；下轮重推，幂等 |
| 增量推 + `BaseRev` 不匹配 | 现有 `StaleBase` 分支不变：本轮报 stale，下轮先 pull 再推 |
