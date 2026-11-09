# 设计：把备份粒度从「库」降到「操作触及的行」

## 一句话

`VACUUM INTO` 整个库 → 改为「只把本 patch 触及的行复制到一个独立小 sqlite」，
恢复时也只 `DELETE+INSERT` 这些行；影响行数超过阈值或显式要求时退回整库兜底（124 版行为）。

## 为什么不是另外两种做法

| 方案 | 否决理由 |
|---|---|
| **补偿操作（saga）**：不备份，失败时反向调用 `NoteAndTags(before...)` / `SetAITitle(before)` | 反向调用有语义损失：`SetAITitle` 会把 `title_source` 从 `user` 改成 `ai`；`ApplyAIProperties` 有 force/保留键语义。恢复一个字节级快照比重新推导状态可靠。**保真度优先于省事。** |
| **只备份两张小表**（`ai_session_meta` + `ai_session_tags`），不管行 | 解决了体积，但仍是全表回滚 → D2（并发丢写）没修；而且 `ai_session_props` 依然漏。**要一起修。** |

## 备份单元：`row snapshot`（新 kind）

新增 `BackupManifest.Kind`：

| Kind | 含义 | 兼容性 |
|---|---|---|
| `""`（空） | 旧 manifest / 整库 `VACUUM INTO` | 按 124 版整表恢复，**代码路径不动** |
| `"rows"` | 本次新增：只含受影响行的快照 | 新恢复函数，按 key 恢复 |

文件名：`<type>-<YYYYMMDD-HHMMSS>-<hash>.rows.sqlite`（`ListBackups` 按 `.sqlite` 后缀扫，
无需改动即可被发现；`PruneBackups` 同样无需改动）。

文件内容（用 `ATTACH` + `CREATE TABLE ... AS SELECT` 从真库只读复制，**主库全程 `mode=ro`**）：

```
sessions 域：   bak.ai_session_meta / bak.ai_session_tags / bak.ai_session_props
                WHERE session_key IN (<本 patch 触及的 key>)
common_text 域：bak.db_common_text WHERE id IN (<本 patch 触及的 id>)
```

三张表**总是全部创建**（哪怕 0 行），否则恢复侧 `SELECT ... FROM bak.x` 会因表不存在而报错。
`CREATE TABLE AS SELECT` 不复制 PK/NOT NULL/索引 —— 恢复不需要，且天然免疫「快照期间 schema 漂移」。

## 影响范围的确定（谁会被写）

| op | 影响范围 |
|---|---|
| `session_note.update` / `session_title.update` / `session_prop.update` | `op.SessionKey`（单 key，三张表全备） |
| `common_text.update` | `op.ID` |
| `tag.rename` domain=`session`/`all` | `SELECT DISTINCT session_key FROM ai_session_tags WHERE tag = ?`（有 `idx_ai_session_tags_tag`） |
| `tag.rename` domain=`common_text`/`all` | 读 `db_common_text`（286 行）在内存里按归一化 tags 过滤出 id |

`tag.rename` 是最坏情况：一次 rename 可能命中全部会话。所以：

```go
const scopedBackupRowLimit = 5000   // 可被测试改写
```

行数 > `scopedBackupRowLimit` → **退回整库 `backupSQLite`（kind 为空）**。
这是刻意的：rename 风暴下 `VACUUM INTO` 慢但正确，而逐个 key 建 IN 列表会把 SQL 参数撑爆。

环境变量兜底：`SNORKELING_AGENTDATA_BACKUP_MODE=full` → 无视 scoped，永远走整库。
用于真出问题时一行降级，不用回滚代码。

## 恢复：按 key 精确回退

```go
// sessions：key 列表从快照自身读出（快照即范围，无需另存元数据）
ATTACH '<snapshot>.rows.sqlite' AS bak;
BEGIN;
DELETE FROM ai_session_meta  WHERE session_key IN (<keys>);
INSERT INTO ai_session_meta  SELECT * FROM bak.ai_session_meta;
DELETE FROM ai_session_tags  WHERE session_key IN (<keys>);
INSERT INTO ai_session_tags  SELECT * FROM bak.ai_session_tags;
DELETE FROM ai_session_props WHERE session_key IN (<keys>);
INSERT INTO ai_session_props SELECT * FROM bak.ai_session_props;
COMMIT;
```

`<keys>` = `bak.ai_session_meta ∪ bak.ai_session_tags ∪ bak.ai_session_props` 的 `session_key` 并集。
**D3 在这里被结构性修好**：`ai_session_props` 出现在恢复语句里，props 不再漏保。

`common_text` 侧同构（按 id）。

`INSERT INTO ... SELECT *` 在列数不一致时 SQLite 直接报错、事务回滚，**不会写坏数据**；
错误照现有风格写进 `OperationReport.Messages`（`backup restore failed: ...`）与 audit。

## 单 op patch 要不要跳过备份？

**不跳过。** scoped 快照成本已经是 O(触及行)，单会话约几百字节；而「哪些 op 本身原子」
的判断矩阵会随时间腐化（新增 op 必须记得更新）。统一路径 + 便宜的快照 > 省一次 KB 级写入。

## 改动清单（文件级）

| 文件 | 改动 |
|---|---|
| `pkg/agentdata/patch.go` | `BackupManifest.Kind`；`createBackupsForPatch` 内部改为 scoped-first + 整库兜底；新增 `createScopedBackup*` / `restoreScopedBackup*`；`restoreBackup` 按 Kind 分派；`var applyOperationFn = applyOperation` 测试缝；`scopedBackupRowLimit` |
| `pkg/agentdata/patch_test.go` | 新增 scoped 备份/恢复/兜底/props 覆盖四组测试 |
| `docs/project/agent-data-patch.md` | Backups 与回滚语义同步更新（现在文档自相矛盾：说 table-level restore，实际整库备份 + 整表恢复） |

**不动**：`cmd/wsh/**`（CLI 语义不变）、`pkg/aisessions/**`、`pkg/commontextstore/**`、
`frontend/**`、`backupSQLite` / `restoreSessionBackup` / `restoreCommonTextBackup`（整库路径保留）。

## 数据安全设计要点

1. **主库只读**：建快照用 `mode=ro` 连接 + `ATTACH` 写新文件。写进真库的只有 `applyOperation`，
   与 124 版完全一致，不多一行。
2. **快照先于写入**：保持现有顺序（preview → backup → apply），快照必然反映 patch 前状态。
3. **快照目录不变**：仍写 `<db 所在目录>/backups/`，不引入新的路径约定，`prune` 逻辑继续有效。
4. **旧备份仍可用**：`Kind == ""` 走老恢复函数，已有 `backups/*.sqlite` 与旧 manifest 不受影响。
5. **兜底不消失**：阈值 + `SNORKELING_AGENTDATA_BACKUP_MODE=full` 两条退路。
6. **测试不碰真库**：全部通过 `t.TempDir()` + `WAVETERM_AI_SESSIONS_SQLITE_INDEX` /
   `commonTextDBPath` 注入，与现有 `setupAgentDataSession` / `setupAgentDataCommonText` 一致。

## 回滚形状

代码回滚 = `git revert` 单提交；数据侧无需动作（本任务不迁移、不删文件）。
已生成的 `.rows.sqlite` 与旧 `.sqlite` 共存于 `backups/`，`prune` 一视同仁。
