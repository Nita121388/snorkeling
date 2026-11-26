# AI Sessions 索引性能深入调查与零功能回退整改计划

## Goal

在不改变任何用户可见功能的前提下，查清 AI Sessions 索引库（本机约 3.42GB）的性能瓶颈，并给出可执行、可回滚的整改计划。最终交付一份 HTML 方案，供评审后再决定是否实施。

## Background / Confirmed Facts

- 索引路径：`~/.snorkeling/ai-sessions/index-v2.sqlite`；本机只读实测约 3.42GB。
- `ai_session_messages` 约 117 万行、2.53GB；其中 text 约 1.06GB、thinking 约 590MB。
- 角色分布：assistant 654,630；tool 451,336；user 64,499；developer 3,990。
- 来源分布：pi 995,573 条消息；codex 175,980；claude 2,183；opencode 782。
- `session_key` 平均约 170B、最长 336B；主表 + 主键索引 + 显式 session 索引 + user 角色索引都重复存储它。
- `idx_ai_session_messages_session(session_key, seq)` 与 `PRIMARY KEY(session_key, seq)` 对应索引重复，约 295MB。
- 最大单条 text 25,578,148B，是 codex 工具目录树输出；最大 thinking 436,198B。
- 原始会话 JSONL 合计约 3.27GB；索引与原文同量级，说明它是“全文缓存 + 索引”，不只是轻量元数据索引。
- 线上症状：`aisessions.Summary` 503（43.65s、0.1kB）与 `aisessions.LiveSessionState` `ERR_EMPTY_RESPONSE`。
- 已确认超时机制：`pkg/web/web.go` 的 `http.TimeoutHandler` 与 `WriteTimeout` 都是 21s；`Summary`/`CurrentModelState` 可经 `resolveSession` 回退全量扫描，join 到最长 60s 的后台扫描。
- 现有功能硬约束：完整会话详情、全文搜索、文字级批注、thinking/工具结果阅读、轮次分页都必须保留；不能截断正文。

## Requirements

### R1 只读、安全的调查环境

- 不修改当前 `index-v2.sqlite`、WAL、SHM 或任何会话 JSONL。
- 需要实验时在仓库根目录 `tmp/` 下制作 SQLite 一致性副本；任务结束清理副本。
- 不启动/重启用户正在运行的 Snorkeling/wavesrv，不批量杀进程。

### R2 性能基线必须可机器判定

- 测当前库与候选结构在相同数据、相同查询下的 P50/P95 或多次中位数。
- 记录查询计划、扫描行数、读取页数、返回字节数、耗时。
- 至少覆盖：列表摘要查询、单会话元数据读取、turn 段元数据扫描、全文搜索、详情正文读取、消息保存/索引更新。
- 区分冷缓存与热缓存；报告机器环境与数据库副本大小。

### R3 根因链完整

- 从 RPC 入口追到 manager/provider/SQLite/HTTP 超时。
- 量化“全量扫描 join、宽表正文 I/O、重复索引、长键重复、搜索拉全文、SaveMessages 整会话重写”各自的影响。
- 区分已证实根因与推断，不用“感觉慢”作为结论。

### R4 零功能回退方案

- 候选方案必须逐项列出受影响功能与兼容性验证。
- 不得用截断 text/thinking、减少消息条数、改变轮定义、丢失 stale 语义等方式换取性能。
- Schema 迁移必须可回滚或可重建；旧版本读取兼容性要说明。
- 每一阶段给出开关、灰度顺序、失败回滚点。

### R5 HTML 整改计划

- 输出到 `docs/answers/`，使用 `am render -o`，frontmatter `collapse: true`。
- 内容包含：结论、证据、根因、方案对比、分阶段计划、功能影响矩阵、性能验收数字、风险与回滚。
- HTML 是评审交付物，不代表已实施。

## Acceptance Criteria

- [x] 任务目录下有一份带 file:line 与实测数字的调查报告。
- [x] 在 `tmp/` 副本上完成至少 6 类查询的当前/候选对比；副本已清理。
- [x] `Summary` 503 与 `LiveSessionState` 断连有完整调用链和根因证据。
- [x] 方案明确覆盖：删重复索引、部分索引、窄元数据表/独立正文表、搜索优化、RPC 超时收口。
- [x] 功能影响矩阵覆盖列表、详情、搜索、批注、轮次分页、实时会话、remote origin。
- [x] HTML 页面生成成功，`collapse: true`，0 渲染错误。
- [x] 本轮零生产代码改动、零当前数据库改动。

## Out of Scope

- 不实施修复，不改 `frontend/`、`pkg/`、`emain/`。
- 不删除用户备份、不 VACUUM 当前库、不重建当前索引。
- 不修改 pi/codex/claude/opencode 的会话文件。
- 不把 G3 时间线正式接入生产；只在方案中说明它与窄元数据表的关系。

## Open Questions

- 无阻塞问题。用户已明确：零功能回退优先；探索完成后交付 HTML 整改计划。
