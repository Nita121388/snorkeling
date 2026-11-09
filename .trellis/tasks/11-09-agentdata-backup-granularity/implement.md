# 实施计划

## 准入门（开工前）

```powershell
. .\scripts\use-local-env.ps1 -Quiet
go test ./pkg/agentdata/... -count=1        # 基线必须全绿，否则先修环境
wsh data backup list --format summary       # 记下现有备份数量，收尾对账用
```

基线记录（2026-11-09）：`~/.snorkeling/ai-sessions/backups/` 存在两个 **0 字节** 残留
（`sessions-20261109-095855-*.sqlite`、`sessions-20261109-095910-*.sqlite`）。
**不清理**，只作为「旧整库路径失败」的证据。

## 步骤

### 1. 数据层：Kind + 快照函数

- [ ] `BackupManifest` 加 `Kind string \`json:"kind,omitempty"\``
- [ ] `const scopedBackupRowLimit = 5000`（包级 var，测试可改写）
- [ ] `const envBackupMode = "SNORKELING_AGENTDATA_BACKUP_MODE"`，值 `full` 强制旧路径
- [ ] `collectPatchScope(patch) (sessionKeys []string, sessionTagRename string, commonTextIDs []string, commonTextTagRename string)`
  - 显式 key/id 去重排序
  - `tag.rename` 记录 from-tag，稍后按 tag 反查
- [ ] `createBackupsForPatch` 改为：`needsSession/needsCommonText` → `createScopedBackup(...)`，
      内部超阈值或 mode=full 时转 `backupSQLite`

验证：`go build ./pkg/agentdata && go vet ./pkg/agentdata`

### 2. 快照构建

- [ ] `createScopedSessionBackup(ctx, keys)`：`mode=ro` 打开主库，`ATTACH <path> AS bak`，
      三张表 `CREATE TABLE bak.<t> AS SELECT * FROM main.<t> WHERE session_key IN (?,...)`，
      空列表也要建表（`WHERE 0`）
- [ ] `createScopedCommonTextBackup(ctx, ids)`：同理只建 `db_common_text`
- [ ] 写 `manifest.jsonl`（`Kind: "rows"`），返回 `BackupManifest`

**如果 `mode=ro` 主库 + `ATTACH` 写入失败**（SQLite 版本差异），退一步用 `mode=rw` 但
**只写 bak**；不得在真库表上执行任何 DDL/DML。

验证：`go test ./pkg/agentdata -run TestScopedBackup -v`

### 3. 恢复分派

- [ ] `restoreBackup` 按 `backup.Kind` 分派：`"rows"` → `restoreScopedSessionBackup` /
      `restoreScopedCommonTextBackup`；其余走现有整表函数（**一行不改**）
- [ ] scoped 恢复：ATTACH → 从快照读出 key 列表 → 单事务内按 key `DELETE`+`INSERT`
      → 三张表（meta / tags / **props**）
- [ ] 列数不一致导致 SQL 报错时，错误信息补前缀 `backup restore failed:`（沿用现有风格）

验证：`go test ./pkg/agentdata -run TestRestoreScoped -v`

### 4. 测试缝 + 四组判据测试

- [ ] `var applyOperationFn = applyOperation`，`ApplyPatch` 内改为调用它（测试可注入失败）
- [ ] `TestScopedBackupOnlyContainsAffectedRows`：3 会话各有 note → patch 1 个 →
      快照文件 `< 64 KB` 且 `SELECT count(*) FROM bak.ai_session_meta` = **1**
- [ ] `TestScopedRestoreLeavesOtherSessionsUntouched`（G3）：3 会话各写不同 note →
      patch 会话 A 并用 `applyOperationFn` 注入第 2 条 op 失败 → 会话 A 回到 patch 前，
      **B/C 的 note 字节级不变**
- [ ] `TestScopedRestoreCoversSessionProps`（G4）：`--note` + `--prop` 两条 op，
      props 写成功后注入失败 → props 回到 patch 前（124 版该测试**必须红**）
- [ ] `TestScopedBackupFallsBackToFullOnLargeScope`（G6）：`scopedBackupRowLimit = 1`
      → manifest `Kind == ""`，文件体积 ≈ 整库
- [ ] `TestScopedBackupDisabledByEnvFullMode`：`t.Setenv(envBackupMode, "full")` → 走整库
- [ ] `TestLegacyFullBackupStillRestores`（G7）：现有 `TestRestoreFromBackupsRestoresSessionAndCommonTextTables` 不改，必须仍绿

```powershell
go test ./pkg/agentdata/... -count=1 -v
go test ./pkg/agentdata/... -run 'Scoped|Legacy|Backup' -count=1
```

### 5. 文档同步

- [ ] `docs/project/agent-data-patch.md`：改正「table-level restore + VACUUM INTO」的自相矛盾，
      写清两种 kind、阈值、`SNORKELING_AGENTDATA_BACKUP_MODE=full` 降级开关、props 纳入覆盖
- [ ] `.trellis/spec/snorkeling-docs/backend/agent-control-surface-contract.md`：
      若其中提到备份语义则同步（用 `grep -n backup` 确认，没有则跳过并在收尾说明）

### 6. 真机验证（**已移交用户**，2026-11-09）

用户明确指示「不需要真机验证 我自己验证」。主 agent 不自行对真库发起写入，
只把可直接执行的清单交出去。

已验证（不含真库写入）：

- [x] `go test ./pkg/agentdata/... -count=1` → ok（39s）
- [x] `go test ./pkg/agentcontrol/... ./pkg/agentmcp/... ./pkg/aisessions/... ./pkg/commontextstore/... ./pkg/wshrpc/... -count=1` → 全部 ok
- [x] `go build ./cmd/wsh` → exit 0
- [ ] 真机写入 / 体积 / 回读 ← **由用户执行**

交给用户的验证清单（数字是判据，不是期望值描述）：

1. 前提：`Get-PSDrive C | Select-Object Free` 可用 > 5 GB
2. 取 hash：`wsh agent card get this --json`（读 `.hash`）
3. 计时写入：
   ```powershell
   Measure-Command { wsh agent card set this --note "验证 scoped 备份" --tags-add acs --tags-add 验证 --yes --expected-hash <hash> }
   ```
   → **墙钟 < 2 s，退出码 0，无 `EC-TIME`**
4. 体积：`Get-ChildItem ~/.snorkeling/ai-sessions/backups/*.rows.sqlite | Select Name,Length`
   → **新文件 < 1 MB，且不应出现新的非 `.rows.` 的 `.sqlite` 文件**
5. 回读：`wsh agent card get this --json` → `note` / `tags` 已落地
6. 审计：`tail agent-data/audit/patch-audit.jsonl` → `success:true`，`operations` 非 null
7. 若要回退行为：设 `SNORKELING_AGENTDATA_BACKUP_MODE=full` 重跑，应退回整库备份（与 124 版一致）

### 7. 收尾

- [ ] `go build ./cmd/wsh` 通过
- [ ] 台账：`node loop/queue.mjs` 相关条目状态更新（若该包在队列里）
- [ ] commit（单提交，`fix(agentdata): scoped row-level patch backups`）

## 回滚点

| 位置 | 回滚方式 |
|---|---|
| 步骤 1–3 任一步失败 | `git checkout -- pkg/agentdata/`，无数据侧影响 |
| 步骤 6 真库行为异常 | 立即 `SNORKELING_AGENTDATA_BACKUP_MODE=full` 降级（无需改码），再 revert |
| 已写入的错误 note/tags | `wsh agent card set this --note "" --tags-set "" --yes --expected-hash <h>` 手工还原 |
