# 执行计划：会话读取入口（探规模 + 按轮分页）

设计：本目录 `design.md`；PRD：本目录 `prd.md`；拍板：`design/plans/session-kernel-design-20261118.md` §8。

工具链：本机 macOS。Go/Task 走 `node scripts/run-task.mjs <task>`；后端单测可直接 `go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/...`。

## 顺序总览

1. 轮切分纯函数 + 索引（无 RPC，先立地基）
2. `SessionInfo`（探规模）
3. `SessionUsers`（第 1 层）
4. `SessionTurns`（第 2 层）
5. `UserOutline` 换 SQL（独立可验收，可与 2-4 并行）
6. `SessionTurn`（第 3 层，最后）
7. CLI
8. MCP
9. 端到端判据采集

---

## 步骤 1 轮切分与索引

- [x] `pkg/aisessions/turns.go`：`ComputeTurns(rows []Message) []Turn`（`Turn{Rows []Message, Preface bool}`），语义照 design §4。
- [x] `pkg/aisessions/turns_test.go`：三个定稿用例（连续 user 合并 / user 跟在非 user 后开新轮 / tool 算回应侧）+ 引导段。
- [x] `sqlite_index.go`：建 `idx_ai_session_messages_user(session_key, role, seq)`（`CREATE INDEX IF NOT EXISTS`，与既有建表块同处）。

**判据**：`go test ./pkg/aisessions/ -run TestComputeTurns -v` 全绿；`sqlite3` 对已建库 `PRAGMA index_list('ai_session_messages')` 含 `idx_ai_session_messages_user`。

## 步骤 2 `SessionInfo`

- [x] `pkg/aisessions/sqlite_index.go`：`SessionReadInfo(ctx, key)` → `{MessageCount, UserMessageCount, Bytes, LastMessageAt, Stale}`（`COUNT(*)`、`MAX(timestamp)`、`ai_files` 失效检查）。
- [x] `pkg/aisessions/manager.go`：`ReadInfo(ctx, identifier)` = `Summary` 解析 identifier + `SessionReadInfo`。
- [x] `aisessionsservice`：`SessionInfo` + `_Meta`；`verdictOf(...)` 纯函数（small/medium/large）。
- [x] `wshrpc`：`AISessionsSessionInfoRequest/Response` 类型 + client/server 路由注册。
- [x] 单测：三种规模样例（构造 sqlite fixture）断言分档。

**判据**：`go test ./pkg/aisessions/ ./pkg/service/aisessionsservice/ -run 'SessionInfo|Verdict' -v` 全绿。

## 步骤 3 `SessionUsers`

- [x] `SQLiteIndex.SessionUserRows(ctx, key, beforeSeq, limit)`：`role='user' AND TRIM(text)!=''`，`seq DESC LIMIT n` 后反转。
- [x] service `SessionUsers`：截断 120 字（rune 安全）+ `truncated` + `nextBeforeSeq/hasMore`。
- [x] 单测：翻页到底不重不漏（20 条×3 页）、空文本 user 被跳过、截断标记。

**判据**：`go test ./pkg/service/aisessionsservice/ -run SessionUsers -v` 全绿。

## 步骤 4 `SessionTurns`

- [x] `SessionTurns`：`limit` 必填 1–10，缺省/越界报错（design §5）；`beforeTurn` 游标。
- [x] 尾部窗口读法：`large` 会话按 user 段 seq 倒序分页，只加载参与窗口的消息（design §8 风险行）。
- [x] 单测：轮号/`toolCount`/`chars`/`ms` 断言；`limit` 缺失与 >10 报错；与 `ComputeTurns` 交叉一致。

**判据**：`go test ./pkg/service/aisessionsservice/ -run SessionTurns -v` 全绿。

## 步骤 5 `UserOutline` 换 SQL

- [x] 改造前先加对照测试：fixture 会话下「旧 `latestUserOutlineMessages` 输出」vs「新 SQL 输出」逐条相等（含 `UserMessageCount`、limit 200 边界、空文本过滤）。
- [x] `Manager.UserOutlineRows`；`service.UserOutline` 改调它；失效检查不过时按现语义 `Load(refresh)` 兜底。
- [x] 验证全量加载不再被触发：debug 日志或 `Load` 调用计数（测试内注入计数器）。

**判据**：`go test ./pkg/service/aisessionsservice/ -run UserOutline -v` 全绿（对照用例逐字节相等）；现有 `aisessions` 测试全绿。

## 步骤 6 `SessionTurn`

- [x] `SessionTurn`：`chars` 必填 ≤8000；单轮消息逐条截断，超限置 `truncated`。
- [x] 单测：>8KB 轮截断标记、`totalChars` 正确、越界 turn 报错。

**判据**：`go test ./pkg/service/aisessionsservice/ -run SessionTurn -v` 全绿。

## 步骤 7 CLI

- [x] `wshcmd-session.go` 加 `session info|users|turns|turn` 子命令，`--json` 两态；人类可读照 `session get` 风格（tabwriter）。
- [x] 参数校验错误带「run `session info` first」提示。

**判据**：`go build ./cmd/wsh && ./wsh session info <已知会话key> --json` 输出 <1KB 且字段齐；`./wsh session users <key> --limit 3` 返回 3 条 user 文本；`./wsh session turns <key>` 无 `--limit` 时报错。

## 步骤 8 MCP

- [x] `agentmcp/tools.go` 加 4 个 `ScopeObserve` + `readOnly` 工具，Schema 对齐 CLI。
- [x] 单测：工具列表快照 + schema 参数字段。

**判据**：`go test ./pkg/agentmcp/ -v` 全绿；工具数由 N → N+4。

## 步骤 9 端到端判据（交验收）

- [x] 取 3 个真实会话（small/medium/large 各一，如本仓 aisessions 索引里的），采集：
  - `session info` 分档与实际消息数一致（AC1）
  - `session users` 三页翻到底条数与 `userMessageCount` 一致（AC2）
  - `session turns` 首/中/末轮与人工比对一致（AC3）
  - `session turn N` 8KB 截断标记（AC4）
  - 门禁错误（AC5，按 design §5 改写后的口径）
  - `UserOutline` 改前后逐字节一致 + 全量路径未触发（AC6）
  - 4 个 MCP 工具与 CLI 参数/返回一致（AC7）
- [x] 采集结果写 `loop/red/` 无红证明 + 本目录 `implement.md` 末尾「判据数字」小节。

**判据**：`go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/... ./pkg/agentmcp/...` 全绿 + 上表逐条数字。

## 回滚点

- 步骤 1/5 独立：索引与纯函数可单独 revert，不影响 RPC。
- 步骤 2-4/6 每个 service 方法独立，未接 CLI/MCP 前对外零影响。
- CLI/MCP（步骤 7-8）最后接，回滚只需删命令注册与工具条目。

## 判据数字（2026-11-18 采集）

### 单测 / 构建

```
go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/... ./pkg/agentcontrol/... ./pkg/agentmcp/... ./pkg/agentscope/...
ok aisessions 8.080s · aisessionsservice 4.581s · agentcontrol 0.558s · agentmcp 1.086s · agentscope 1.228s
go build ./cmd/wsh ✓   go vet ✓   gofmt ✓
```

### 真实索引库探针（只读连接，`~/.snorkeling/ai-sessions/index-v2.sqlite`，3889 会话 / 485945 消息）

| 规模 | key 前缀 | messages | bytes | user 消息 | verdict | 轮数 | turns 单页耗时 |
|---|---|---|---|---|---|---|---|
| small | `pi:3c7fdf0b` | 56 | 212,539 | 1 | small | 1 | 0 ms |
| medium | `pi:782d6fdf` | 526 | 1,234,562 | 10 | medium | 10 | 0 ms |
| large | `pi:b3070081` | 4,675 | 11,700,233 | 73 | large | 67 | 5 ms（span 聚合 2 ms） |
| large | `codex:019cbcbb` | 1,805 | 10,193,643 | 295 | large | 125 | 1 ms |

- **翻页一致性**：三档 `users` 逐页翻到底，行数 == `COUNT(user)`；页内 seq 严格递增、不重不漏。
- **轮切分一致性**：三档 SQL 分页得到的轮首序列 == `ComputeTurns` 全量扫描结果（逐 seq 相等）。
- **门禁**：`turns` 缺 `--limit` / `>10`、`turn` 缺 `--chars` / `>8000` → `E_USAGE` 且带 `session info` 指路（CLI 先于 RPC 触发，无需 app 运行）。
- **性能**：20000 消息 / 10000 轮 fixture，`ReadTurns(limit=5)` SQL 行 ≤18、Go 分配 **174,464 B**（对照正文 4,058,894 B，≈4.3%）。

### 探针踩到的两个坑（已确认非产品 bug）

1. `ReadUsers` 的游标是 `NextBeforeSeq = rows[0].Seq`（本页**最小** seq）。探针一开始传了本页最大 seq，导致翻页重复；按服务语义修正后一致。
2. `ai_sessions.message_count` 可能早于消息索引（实测某会话 summary 44 / 索引 526）。`ReadInfo` 用「索引计数更大则升级」兜底，`verdict` 随之按真实条数计算——这是有意行为，不是漂移。

### 未覆盖（显式声明）

- 真机 CLI 端到端（`wsh session info` 打到运行中的 wavesrv）需要**重新构建并启动 app**，当前运行的实例不含新命令，留到发版冒烟。
- 前端 UI 未动，无像素/界面验证需求。
