# A6 设计 — journal / 提议制 / 蒸馏

## 1. 边界

| 层 | 文件 | 职责 |
|---|---|---|
| 新增 | `pkg/persona/journal.go` | `AppendJournal`（当班留痕）、`ListInbox` / `ApproveInbox` / `DismissInbox`（提议制） |
| 新增 | `pkg/persona/distill.go` | `Distill` / `UndoDistill`（去重 + TL;DR + 备份） |
| 测试 | `journal_test.go` / `distill_test.go` | 纯文件系统，机器判定 |
| CLI | `cmd/wsh/cmd/wshcmd-persona.go` | `journal append` / `memory inbox\|approve\|reject` / `distill` |

## 2. 契约

### 2.1 journal 行

```
- 2026-11-13T04:00:00Z [done] agent:pi（会话 s1） — 完成备份归档
```

`AppendJournal(root, id, JournalEntry{State, Summary, Source, Now})`；
状态白名单 `working|blocked|done|stale`（空 → `done`）；一行一事件，追加不重写；
追加后 `WriteRoster` 刷新 💤 休眠判定（与 A2.5 `AddMemory(journal)` 同口径）。

### 2.2 inbox 提议块（沿用 A2.5）

```
## <ts> <section> propose

- 来源: agent:x（会话 s）
- 目标: MEMORY/facts.md
- 内容: <正文>
- 状态: approved        ← 批准/驳回后追加（旧块无此行 = pending）
```

`ListInbox` 解析为 `InboxItem{Stamp, Section, Source, Target, Content, Status}`。
`ApproveInbox(root,id,stamp,by)`：
1. 找 pending 项；已 approved → 幂等 no-op；dismissed → 拒绝；
2. 目标只能是 `MEMORY/facts.md` / `lessons.md` / `CHARTER.md`（白名单防路径逃逸）；
3. 内容追加到目标文件（不覆盖），inbox 块标记 `approved`，`AppendJournal` 记一条 `done` 审计；
4. 跨文件一致性由单测断言（目标含正文 + inbox 状态 + journal 有记录）。

`DismissInbox` 只标记 `dismissed`，保留块与出处。

### 2.3 蒸馏（纯函数 + 文件 IO）

```
Distill(root, id, opts{Threshold, DryRun}) → DistillResult{Before, After, Duplicates, TLDR, Backup}
```

- 只对 `facts.md` 的 `## 正文` 与 `lessons.md` 的 `## <date>` 分节里的 `- ` 条目去重（规范化空白后比较）；
- 条目数 > Threshold 才触发；`## TL;DR` 由蒸馏重写为**最近 5 条**（不足则全留）；
- 写前把两文件原文备份到 `.persona/MEMORY/archive/.distill-backup-<ts>.json`（gitignore 的 archive 是记忆的一部分 → 随 git 走，可跨机回滚）；
- `UndoDistill(root,id)` 还原最近一次备份；
- 覆盖率：非重复条目在蒸馏后全部仍在（单测逐条断言）。

## 3. 风险与回滚

| 风险 | 处置 |
|---|---|
| 批准写进 CHARTER 覆盖人写正文 | 只 append，绝不重写；目标白名单 |
| inbox 解析把正文里的 `- ` 行当元数据 | 只识别已知的四个键，其余忽略 |
| 蒸馏丢记忆 | 非重复条目零丢失断言 + 备份 `--undo` |
| 重复批准写两遍 | 状态机 + 幂等 no-op |

回滚：新增文件 + CLI 注册，`git revert` 单 commit，无迁移。
