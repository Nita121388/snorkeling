> **Confirmed: 2026-11-09 @nita**

# Common Text 条目级同步水位：区分「已同步 / 待上传」

## Goal

让 Common Text 能按**条目**回答「这条有没有传到云端」。今天做不到不是 UI 缺徽标，而是数据层没有这个信息：

- `db_common_text` 只有 `rev` / `deletedat`，没有「上次成功同步到哪个版本」的水位列
  （`pkg/commontextstore/commontext_store.go:51-52`）。
- 本地编辑**不 bump rev**：`frontend/app/commontext/commontext-model.ts:655` 是 `rev: existing?.rev ?? 0`，
  `rev` 只由 transport 在远端侧 +1（`pkg/sync/transport_folder.go:146-196`）。
- 引擎每轮把**全表**推一遍，没有 dirty 集合（`pkg/sync/engine.go:317` 取全部条目整包 Push）。
- 落地可观测信息只有全局计数：`syncmanager.Status` 是 `lastPulled/lastApplied/lastPushed` 四个整数
  （`pkg/syncmanager/syncmanager.go:52-70`），journal 的 push 事件只有数量没有 id
  （`pkg/syncjournal/syncjournal.go:50-70`）。所以「哪一条没上传」今天无法回答，事后也无法重建。

本包给条目加同步水位，让下面三件事同时成立：
1. **一条条目能判定**：`synced`（水位 >= 本条 updatedat）或 `pending`（从未同步 / 改过没推上去）。
2. **引擎按水位增量推**：只推 pending 的条目，`lastPushed` 从「全表数」变成真实增量数。
3. **UI 一条一眼看出来**：列表行一个点 + 详情页脚一行 `Sync`，并与 CLI `wsh commontext-sync pending` 同源。

顺带修掉同一条链路上的数据缺陷：**UI 删除不写墓碑**
（`frontend/app/commontext/commontext-model.ts:672-676` 直接 filter 掉），
导致删除推不出去、对端下次 pull 把条目复活。

## 做什么

1. **水位存储**：新表 `db_common_text_sync`（`id / syncedrev / syncedupdatedat / syncedat`），
   迁移 `000014`。放独立表而不是给 `db_common_text` 加列，因为 `commontext:items` 的写路径是
   「前端整表覆盖」（`saveCommonTextItems` → `SaveFromConfigMap` → `saveCommonTextItemsToDB`），
   前端手里的旧副本会把列里的水位冲掉；独立表不被整表覆盖碰到。
2. **派生状态单一来源**：`commontextstore` 出一个纯函数
   `CommonTextSyncState(item, watermark) -> "pending" | "synced"`，读路径 `List()` 填进
   `wconfig.CommonTextItemType.syncstate`，引擎、CLI、UI 三处都读这一份，不各自算。
3. **`PushOutcome` 带条目明细**：`syncproto` 加 `PushItemResult{Id, Rev, Status}`，
   folder/git/server 三个 transport 与 server 端 `Apply` 都填；引擎据此回写水位。
4. **引擎增量推送**：`Store` 接口加 `PendingItems` / `MarkSynced`；稳态（BaselineNone）只推 pending，
   baseline 切换（local/remote 选边）仍推全量（种子远端必须全量）。
5. **远端被重置的自愈**：pull 拿到的 `remote.Rev` 小于本地已确认的最大 `syncedrev` → 清水位、全量重推，
   否则「用户删了同步文件 / 换了空目录」时本地条目会永远静默不上传。
6. **墓碑**：`deleteCommonTextItem` 改成写 `deletedat + updatedat` 保留条目；列表/搜索/标签统计过滤墓碑。
7. **UI**：列表行标题后一个 `data-commontext-sync-state` 圆点（只 pending 显示）+ 详情页脚
   `Sync` 一项（`Synced · rev 12` / `Pending upload`），与派生状态同源。
8. **CLI**：`wsh commontext-sync pending [--json]` 列出待上传条目；`show --json` 带 `pending` 计数。

## 不做什么

- 不做实时自动同步（fsnotify）：仍按现有 5 分钟定时 + 手动 `Sync now`。
- 不做 GUI 全局同步 pill / 同步浮层（原型里那块，属另一个包）。
- 不改冲突判定策略（`DetectConflictFields` / 三路合并规则保持不变）。
- 不动 `cmd/snorkeling-sync` 的独立 SQLite 直读路径，只让它实现新增的两个 Store 方法并填 `PushItemResult`。
- 不迁移历史数据的 rev：老条目没有水位行 → 一律 `pending`，第一次同步后自然清零。

## 验收判据

> 每条都是「命令 → 期望输出」，`prove` 阶段逐条采数。

| # | 命令 | 期望 |
|---|---|---|
| 1 | `go test ./pkg/commontextstore/ ./pkg/sync/ ./pkg/syncmanager/ ./pkg/syncproto/ ./pkg/syncjournal/ ./pkg/syncconflict/` | 全部 `ok`，无 `FAIL` |
| 2 | `go test ./pkg/commontextstore/ -run TestSyncWatermark 2>&1 \| tail -1` | `ok  github.com/wavetermdev/waveterm/pkg/commontextstore` |
| 3 | `go test ./pkg/sync/ -run 'TestEngine(PushesOnlyPending\|BaselineStillPushesAll\|RemoteResetRepushesAll\|MarkSyncedFromPushOutcome)' 2>&1 \| tail -1` | `ok  .../pkg/sync` |
| 4 | `go test ./pkg/syncmanager/ -run TestStatusReportsPendingCount 2>&1 \| tail -1` | `ok  .../pkg/syncmanager` |
| 5 | `npx vitest run frontend/app/commontext --reporter=dot 2>&1 \| tee /tmp/ct.log \| grep -E "Tests +[0-9]+ passed"` | 输出一行 `Tests  N passed`，且 `/tmp/ct.log` 内无 `failed` |
| 6 | `node scripts/check-tsc-baseline.mjs && echo TSC_BASELINE_OK` | `TSC_BASELINE_OK` |
| 7 | `go vet ./pkg/commontextstore ./pkg/sync ./pkg/syncmanager ./pkg/syncproto` | 无输出 |

`skipped`（有意不覆盖，必须在收尾说明里写出来）：

- **真机两台设备对打**：`commontextstore` 绑全局 `wstore` 单例，单测里起不了第二份 DB，
  两设备端到端要真机 + 两个数据目录，成本超本包 budget。两侧行为用 fake store + 真 SQLite 单机
  分片覆盖（判据 2/3/4），真机联调留给验收人手工确认。
- **像素证据**：新增的是一个圆点与页脚一行文本，无布局重排，未做 L4 像素测值。

## G1 签字

> 范围：做什么 8 条 / 不做什么 5 条 / 验收判据 7 条，均已冻结。
> 签字后正文改动会被 `queue.mjs drift` 判为 DRIFT 并回退 `blocked:g1`。


## 实施偏差记录（签字后追加，不参与 prdHash）

1. **新 RPC 落在 `pkg/wshrpc/wshserver`，不是 `pkg/service/commontextservice`。**
   原计划给服务层加 `SyncPending` / `SyncMarkSynced` 两个服务方法。实际执行时发现：需要这两个
   能力的是 **`wsh` CLI**（它走 `wshclient` → WshServer 通道），而前端拿到 `syncstate` 靠的是
   `HydrateFullConfig` 把 DB 里的条目灌进 settings（列表页不需要额外 RPC）。落在 service 层
   只能被前端调用，CLI 反而拿不到，所以改成 WshServer 命令：
   `CommonTextSyncPendingCommand` / `CommonTextSyncMarkSyncedCommand`。
2. **`scripts/check-tsc-baseline.mjs` 一并修了。** 它在 Windows 上 `execFileSync("npx", ...)`
   必然 ENOENT（Node 不套 PATHEXT，真正存在的是 `npx.cmd`），所以这道闸门一直是 exit 2
   （环境错误）而不是「未超基线」。改成优先用 `node_modules/typescript/bin/tsc`，
   判据 6 才第一次真正成立。已把该文件加进包 `touch` 白名单。
