# agentdata 备份粒度：按操作范围降级，消除整库 VACUUM INTO

## 背景（真机实测，2026-11-09，Snorkeling 0.14.6-beta.0.snorkeling.0.0.124）

在 124 版用 ACS 控制面给活跃会话写 note/标签，两次真实写入全部失败：

```
wsh agent card set <key> --note "..." --tags-add ... --yes --expected-hash <h>
→ Error: EC-TIME: timeout waiting for response
```

现场证据：

| 证据 | 值 |
|---|---|
| `~/.snorkeling/ai-sessions/backups/sessions-*.sqlite` | 两个文件，**0 字节** |
| `agent-data/audit/patch-audit.jsonl` | `{"success":false,"error":"context deadline exceeded","operations":null}` |
| `index-v2.sqlite` | **2.86 GB** |
| 其中 `ai_session_messages` + 2 个索引 | 2204.9 + 251.7 + 251.7 MB = 约 2.71 GB |
| `ai_session_meta`（note/title） | **1.3 MB**，4906 行 |
| `ai_session_tags` | **0.395 MB**，1693 行 |
| `waveterm.db`（`db_common_text`） | 954 KB，286 行 |
| 两库 `journal_mode` | 都是 `wal` |
| C: 盘可用 | **2.6 GB** |

结论：为写入 1.3 MB 的表，代码先复制 2.86 GB；`wsh` RPC 默认 15 s，`VACUUM INTO`
在这台机器上永远跑不完 → 必然 `EC-TIME`，且 C: 盘只剩 2.6 GB 时连跑完的余量都没有。

## 现状的三个缺陷

### D1 备份最贵

`createBackupsForPatch`（`pkg/agentdata/patch.go:1072`）→ `backupSQLite`（`:1119`）对整库
`VACUUM INTO`，与操作实际触及的行数无关。单条 note/tags 写入也要复制 2.86 GB。

### D2 回滚最粗

`restoreSessionBackup`（`pkg/agentdata/patch.go:1295`）是**整表**快照回滚：

```sql
DELETE FROM ai_session_tags; INSERT INTO ai_session_tags SELECT * FROM backup.ai_session_tags;
DELETE FROM ai_session_meta; INSERT INTO ai_session_meta SELECT * FROM backup.ai_session_meta;
```

一个 patch 内第 2 条 op 失败会触发整表回退，把备份时刻之后**任何会话**的 note/tags
一起抹掉 —— 用「跨会话并发丢写」换「patch 内部原子性」，代价方向反了。

### D3 覆盖面漏

`grep -c "ai_session_props" pkg/agentdata/patch.go` = **0**。
`session_prop.update` 会写 props 表，但 restore 完全不碰它：`--note` + `--prop` 组合里
props 写成功、后续 op 失败时 **props 不会被回滚**。付了 2.86 GB 的保险费，漏保了真正会
部分失败的那张表。

## 目标

| # | 目标 | 判据（命令 → 期望输出） |
|---|---|---|
| G1 | 单 op / 同库小范围 patch 的写入成本与数据量脱钩 | 在 2.86 GB 真库上 `time wsh agent card set this --note x --tags-add y --yes --expected-hash h` → 墙钟 **< 2 s**，退出码 0 |
| G2 | 备份体积按影响行数走，不再与库体积挂钩 | 同上调用后 `ls -l ~/.snorkeling/ai-sessions/backups/` 新增文件 **< 1 MB** |
| G3 | 回滚只撤本 patch 触及的行 | 3 个会话各有 note，patch 其 1 个并在中途失败 → 另 2 个会话 note **字节级不变** |
| G4 | props 纳入回滚覆盖 | `--note` + `--prop` 组合，props 写成功后后续 op 失败 → `agent card get` 的 props **回到 patch 前值** |
| G5 | 跨库 `tag.rename --domain all` 仍有备份 | 该 patch 的 audit 中 `backups` 非空，且两库都被覆盖 |
| G6 | 爆炸半径真大时保留整库兜底 | 影响行数 > `scopedBackupRowLimit`(5000) 或 `SNORKELING_AGENTDATA_BACKUP_MODE=full` → 行为与 124 版一致（整库 `VACUUM INTO`） |
| G7 | 旧备份文件仍可用 | 已有 `backups/*.sqlite`（无 `kind` 字段的 manifest 条目）仍能走原整表 restore，现有测试不改即通过 |

## 数据安全红线（本任务不可违反）

1. **真库只读**：实现与测试期间，`~/.snorkeling/ai-sessions/index-v2.sqlite` 与
   `%LOCALAPPDATA%\snorkeling\Data\db\waveterm.db` 不得被本任务的代码路径写入，
   除非是用户显式发起的 `wsh agent card set --yes`（那正是要验证的一条）。
2. **测试只碰临时库**：单测/集成测试用 `t.TempDir()` 造库，通过
   `WAVETERM_AI_SESSIONS_SQLITE_INDEX` 与 `commonTextDBPath` 注入，禁止指向用户真实目录。
3. **不删用户的备份文件**：`backups/` 下已存在的文件（含两个 0 字节残留）不在本任务内清理，
   如需清理必须由用户单独确认。
4. **失败必须可见**：任何回滚失败都要写进 `OperationReport.Messages` 和 audit，
   不允许静默吞掉（沿用现有 `backup restore failed:` 风格）。
5. **降级路径保留**：G6 的整库兜底必须与 124 版行为字节级一致，作为出问题时的退路。

## 非目标

- 不改 `wsh agent card set` 的 CLI 语义、参数、错误码。
- 不改 `ai_session_*` 表结构，不做数据迁移。
- 不改 UI 侧的 `service.NoteAndTags` 路径（它本来就不走 patch 备份管线）。
- 不优化 `index-v2.sqlite` 体积本身（2.86 GB 是另一个话题）。
- 不清理历史备份文件。

## 验收方式

`node scripts/run-task.mjs` 不涉及；本任务用：

```powershell
. .\scripts\use-local-env.ps1 -Quiet
go test ./pkg/agentdata/... -run 'Backup|Scoped|Restore' -v -count=1
go build ./cmd/wsh
```

真库验证（G1/G2）是**最后一步**，前置条件：G3–G7 在临时库上全绿 + 已用
`wsh data backup list` 确认没有新的整库备份残留。
