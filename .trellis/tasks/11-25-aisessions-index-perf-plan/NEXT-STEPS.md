# 明天继续：AI Sessions 索引性能调查收尾

> 状态时间：2026-11-25 晚。已提交推送：`270fc19cd`（`origin/main`）。
> 本任务仍在 `planning`，未动生产代码、未动当前索引库。

## 已完成（可直接引用）

| 产物 | 位置 |
|---|---|
| 需求/约束 | `.trellis/tasks/11-25-aisessions-index-perf-plan/prd.md` |
| 技术设计（分阶段 A–D + 影响矩阵 + 验收门 + 回滚） | `design.md` |
| 执行清单 | `implement.md` |
| 性能基线（固化数字，tmp 清理后仍可用） | `research/performance-baseline.md` |
| RPC 超时根因链 | `research/rpc-timeout-root-cause.md` |
| 正文/thinking 消费方与迁移面 | `research/message-consumers-schema-migration.md` |
| 早期评审页（HTML） | `docs/answers/aisessions-index-size-review-20261125-140318.html` |

核心数字（3.42GB 快照，`quick_check=ok`）：

- 搜索 P50 **4,318.829ms**，拉取 **866,101,849B** 文本 → 最明确的用户可感知缺陷。
- 朴素 SQL `instr(lower(text))` 8,859ms，且 Unicode 语义不等价 → **禁止直接替换**。
- 最大会话 turn 扫描 30.338ms；最大正文详情 39.072ms（宽表顺序读不慢）。
- SaveMessages 最大正文 424.604ms / 最大消息数 503.939ms（整会话重写）。
- 重复索引 295,862,272B；user 部分索引 278.55MB→14.36MB；两项 + VACUUM → 2.83GB（-17.38%）。
- 整数窄元数据 44.88MB，turn 30.338→9.195ms。
- 初版三表 equijoin 详情 2,761ms（70.7× 回退）→ **暂缓拆正文表**。

## 明天要做的三件事

### 1. 补完搜索候选与 loadAll 复现基准（`implement.md` 第 7 项）

工具已写好并编译通过：`tmp/aisessions-index-perf-bench/followup/`（`followup.exe`，31.5MB）。

已修的编译错误：

- `MessageDelta.NextOffset` → 正确字段是 `NextMessageOffset`（`loadall.go` 两处）。
- `semantics.go` 删掉未使用的 `github.com/jmoiron/sqlx` import。

**已知未修问题**：`-mode loadall`（以及 `-mode all`）报 `fatal: no such table: ai_session_messages`。

原因判断（未验证）：`loadall.go` 里用 `aisessions.NewManagerWithOptions` 建 manager 后，立刻用裸 `openSQLite(manager.SQLitePath)` 打开 observer 并查 `ai_sessions/ai_files/ai_session_messages`，但 schema 是惰性创建的，observer 看到的是空库。

建议修法：在 open observer 之前先热身 schema——

```go
if idx, err := aisessions.OpenSQLiteIndex(manager.SQLitePath, manager.MetaPath); err == nil {
    _ = idx.Close()
}
```

（`OpenSQLiteIndex` 在 `pkg/aisessions/sqlite_index.go:36`，导出可用。）

跑法：

```bash
cd tmp/aisessions-index-perf-bench/followup
powershell -NoProfile -ExecutionPolicy Bypass -Command ". E:\code\snorkeling\scripts\use-local-env.ps1 -Quiet; go build -o followup.exe ."
./followup.exe -mode loadall -db ../baseline.sqlite -out-dir work -report-dir .. -runs 5
./followup.exe -mode search  -db ../baseline.sqlite -out-dir work -report-dir .. -runs 5
./followup.exe -mode semantics -out-dir work -report-dir ..
```

输出：`../loadall-followup-results.json`、`../search-followup-results.json`、`../semantic-followup-results.json`。

判据：

- loadAll >3 帧：首帧之后 `ProviderLoadCalls` / `SaveMessagesEquivalent` 增量应为 **0**，`session_mtime/size` 不为 0。
- 搜索：结果与当前实现逐条一致（语义对拍），P50 目标 ≤1,500ms。
- semantics：确认 SQLite `lower()` 与 Go `strings.ToLower` 不等价的用例清单（已有 10 例，含 `ß`/`İ`/希腊末尾 sigma/组合重音/CJK/emoji）。

⚠️ 上次单跑 `-mode search` 5 轮 × 3 候选被手动中断（每次都全表扫，很慢）。建议 `-runs 3` 起，或后台跑。

### 2. 生成 HTML 整改计划（`implement.md` 第 9 项）

草稿已写好、只差数字补充：`tmp/aisessions-index-perf-plan.md`（含 A–H 八节：裁决/基线/根因/存储收益/分阶段/影响矩阵/验收数字/证据边界）。

生成命令（必须带 `-o`，frontmatter 已写 `collapse: true`）：

```bash
cd E:/code/snorkeling
am render tmp/aisessions-index-perf-plan.md -o docs/answers/aisessions-index-perf-plan-20261126.html
```

验收：`collapse: true` 保住、0 渲染错误、面板数=章节数。

### 3. 清理 tmp（`implement.md` 第 10 项）

当前 `tmp/aisessions-index-perf-bench/` = **13G**，E 盘剩余 21G。

保留：`REPORT.md`、`SUMMARY.json`、`bench-results.json`、`followup/*.go`（若要留证据链）。
必须删：`baseline.sqlite`、`candidate-int.sqlite`、`rewrite-current.sqlite`、`variants.sqlite`、`body-layout-sample.sqlite`、`raw/`、`work/`。

```bash
cd E:/code/snorkeling/tmp/aisessions-index-perf-bench
rm -f baseline.sqlite candidate-int.sqlite rewrite-current.sqlite variants.sqlite body-layout-sample.sqlite
rm -rf raw work loadall-* followup/work
```

注意：`baseline.sqlite` 是唯一一致性快照，删掉后若要重测需重新 backup（上次 109.5s）。建议**先把第 1、2 项跑完再删**。

## 收尾后

- 更新 `implement.md` 勾选 7–10。
- 补 `research/performance-baseline.md` 的搜索候选与 loadAll 实测数字。
- 提交推送。
- 用户评审 HTML 后再决定是否 `task.py start` 进入实施；实施拆包顺序见 `design.md` §3 与 `implement.md`「未来整改包顺序」（P0-A RPC 预算 → P0-B loadAll freshness → P1-A 索引 → P1-B sidecar → P2-A 搜索 → P2-B 增量写入）。

## 安全例外（必须随方案保留）

备份期间运行中的 Snorkeling 改写了原库；只读 WAL 打开与新出现的 `-shm/-wal` 时间接近，**不能严格证明原库 sidecar 零触碰**。快照本身 `quick_check=ok`，备份后未再打开原库。
