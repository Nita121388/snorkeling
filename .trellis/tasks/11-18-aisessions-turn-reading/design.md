# 技术设计：会话读取入口（探规模 + 按轮分页）

设计出处：`design/plans/session-kernel-design-20261118.md` §2（拍板记录 §8：Q1 四层一起做，`turn` 排最后）。

## 1 边界

- **只读**。`Detail` / `DetailDelta` / `UserOutline` 的对外签名与语义不动（`UserOutline` 只换内部实现）。
- **单会话点查**。不挂 List 批量路径（128MB/5s 预算与 21s web 超时是既有红线，PRD 约束）。
- **GUI 不动**。本包只新增后端 RPC + CLI + MCP；前端 UI 接入（分页菜单等）属 `11-18-aisessions-pager-turn-label` 等任务。
- `ai_session_messages` 表不加列不加行，只加一条索引。

## 2 现状锚点（真实代码）

| 锚点 | 事实 |
|---|---|
| `pkg/aisessions/sqlite_index.go:157` | `ai_session_messages(session_key, seq, role, text, timestamp, tool_name, thinking, char_count)`，PK `(session_key, seq)` |
| `sqlite_index.go:1340-1370` | `LoadMessages`（按 key 全量读，带 `ai_files` mtime/size/`message_indexed` 三重失效检查） |
| `sqlite_index.go:242` | 现有索引 `idx_ai_session_messages_session(session_key, seq)`；无 `(session_key, role, seq)` |
| `pkg/service/aisessionsservice/aisessionsservice.go:1305` | `UserOutline`：`manager.Load` 全量加载后 `latestUserOutlineMessages` 内存筛（滑动窗口保留最新 N 条，返回**正序**） |
| `pkg/aisessions/manager.go:860` | `Summary(identifier, refresh)`：不加载消息的元信息入口（`SessionSummary` 有 `MessageCount`/`Size`） |
| `cmd/wsh/cmd/wshcmd-session.go` | CLI 现有 `session live/get/list/for-block`；`wshclient.XCommand` 命令路由模式 |
| `pkg/agentmcp/tools.go:159-213` | MCP `snorkeling_session_live/get/list`，`be.SessionGet(ctx, req)` 后端接口模式 |
| commit `032a2911d` | 前端 `computeTurnPages` 的轮切分定稿：**一轮 = 一段连续 user 消息（同一问）+ 其后到下一段 user 前的全部非 user 消息**；只有 user 跟在非 user 之后才开新轮；首个 user 之前的行自成引导页 |

## 3 RPC 契约

四个新 service 方法（`aisessionsservice`），CLI 与 MCP 共用；请求均带 `Connection`/`Origin` 走 `managerForScope`（与 `UserOutline` 一致）。

### 3.1 `SessionInfo` — 探规模（无正文）

```
SessionInfoRequest  { id }
SessionInfoResponse {
  sessionKey, messageCount,        // 复用 summary.MessageCount
  userMessageCount,               // SELECT COUNT(*) WHERE role='user' AND text != ''
  bytes,                          // summary.Size
  lastMessageAt,                  // MAX(timestamp)
  verdict,                        // small | medium | large
  stale                           // ai_files 失效检查未过 → true（提示调用方先刷新，不静默降级）
}
```

分档：`small` ≤150 条且 ≤2MB；`large` >1200 条或 >20MB；其余 `medium`。

### 3.2 `SessionUsers` — 第 1 层

```
SessionUsersRequest  { id, limit=20(≤100), beforeSeq }
SessionUsersResponse { rows: [{seq, at, text(截120字), truncated}], nextBeforeSeq, hasMore }
```

- `text != ''` 过滤与 `latestUserOutlineMessages` 对齐（空文本 user 消息不算）。
- `ORDER BY seq DESC LIMIT n` 后反转回正序。

### 3.3 `SessionTurns` — 第 2 层

```
SessionTurnsRequest  { id, limit=5(≤10), beforeTurn }
SessionTurnsResponse { rows: [{turn, seq, at, text(截120字), toolCount, chars, ms}], nextBeforeTurn, hasMore }
```

- 轮号从 1 起，按 §4 算法切分；**引导页（首个 user 之前的行）不占轮号**，`turns` 不返回它（那是 GUI 分页的事）。
- `chars` = Σchar_count；`ms` = 轮尾 timestamp − 轮首 timestamp；`at` = 轮首（连续 user 段第一条）的时间。

### 3.4 `SessionTurn` — 第 3 层（排最后做）

```
SessionTurnRequest  { id, turn, chars=2000(≤8000) }
SessionTurnResponse { rows: [{seq, role, at, text, truncated}], truncated, totalChars }
```

## 4 轮切分算法（单一事实来源）

与前端 `computeTurnPages`（`annotation-model.ts`，commit `032a2911d`）**逐条对齐**，否则 GUI 分页与外部读取的"轮"对不上：

```
state: current = nil, sawReply = false
for row in seq 升序:
  if current == nil: current = {rows: [row], sawReply: false}; continue(标记为引导段)
  if row.role == user and current.sawReply: 开新轮（current = {rows: [row], sawReply: false}）
  else: current.rows.append(row)
  if row.role != user: current.sawReply = true
```

- 连续 user 消息并入同一轮（排队补充/贴文件算一问）；`tool`/`thinking` 消息算回应侧。
- 建议抽 `pkg/aisessions/turns.go` 纯函数 `ComputeTurns(rows []Message) [][]Message`（引导段返回但标记），前端后续可迁移同一语义（本包不动前端）。

## 5 设计取舍：门禁怎么做（**需确认，改 PRD AC5**）

PRD 写「未调用 `info` 拿不到分档时，`turns`/`turn` 拒绝读消息」。RPC **无状态**，服务端记不住「这个调用方调过 info 没有」；加服务端会话状态表（key→最近 info 时间，TTL）引入有状态、重启丢失、多客户端错判。

**替代方案（推荐，等价达成意图）**：把门禁降为**结构化强制**——

1. `SessionTurns` **必须显式传 `limit`（1–10）**，不传或超限 → 明确报错（错误信息里指路「先跑 `session info` 看分档」）。
2. `SessionTurn` **必须显式传 `chars`（≤8000）**，同上。
3. `SessionUsers` `limit` 默认 20、上限 100（沿用 UserOutline 上限习惯的量级）。

这样「一次绝不拉全量」由参数上界硬保证，且无状态、可单测。**AC5 改写为**：`turns` 不传 `limit` / `limit`>10、`turn` 不传 `chars` / `chars`>8000 时返回明确错误（有测试）。

## 6 `UserOutline` 换 SQL 直查

- 新增索引：`CREATE INDEX IF NOT EXISTS idx_ai_session_messages_user ON ai_session_messages(session_key, role, seq)`。
- `Manager` 新增 `UserOutlineRows(key, beforeSeq, limit)`（SQLite 层 `SELECT seq, text, timestamp FROM ai_session_messages WHERE session_key=? AND role='user' AND TRIM(text)!='' AND seq<? ORDER BY seq DESC LIMIT ?`，反转回正序）。
- **逐字节一致要求（AC6）**：
  - 现实现先 `manager.Load`（会顺带刷新索引），再内存筛。SQL 版必须先做同样的 `ai_files` mtime/size 失效检查；检查不过 → 沿用现语义走 `Load(refresh)` 兜底并返回结果（不静默返回旧库数据）。
  - `UserMessageCount` 继续等于「全量非空 user 消息数」（`COUNT(*)`），不是本页数。
  - `limit` 默认 20、上限 200 不变；`Refresh` 字段语义不变。

## 7 CLI + MCP

- `cmd/wsh/cmd/wshcmd-session.go` 加 4 个子命令：`session info <id>` / `session users <id> --limit --before-seq` / `session turns <id> --limit --before-turn` / `session turn <id> --turn --chars`；`--json` 与人类可读两态（模式照抄 `session get`）。
- `pkg/agentmcp/tools.go` 加 4 个 `ScopeObserve` + `readOnly` 工具：`snorkeling_session_info/users/turns/turn`，Schema 与 CLI 参数一一对应，`Invoke` 走 `be.SessionXxx`。
- 参数校验错误统一带「run `session info` first」提示。

## 8 风险与回滚

| 风险 | 缓解 |
|---|---|
| 索引 stale 导致轮切分缺消息 | `ai_files` 三重失效检查；`info` 返回 `stale=true`；users/turns 遇 stale 同样提示刷新，不静默 |
| 轮切分与前端 `computeTurnPages` 漂移 | §4 算法逐条对齐 + 交叉测试：同一会话两侧切分结果一致性用例 |
| `UserOutline` SQL 版与旧实现输出不一致 | 改造前先写「旧实现快照 vs SQL 版」对照测试；AC6 逐字节断言 |
| 大会话 turns 每页都要全量读消息再切轮 | 中/大会话（medium/large）`turns` 用 `beforeTurn` 只取尾部窗口：先按轮首 seq 定位（SQL 找 user 消息的 seq 列表倒序分页），只加载参与的窗口段 |

## 9 不做（显式出界）

- 阶段时长聚合（→ `card-phase-timeline`，拍板 Q3：后端聚合，本包不做）。
- 批注写回（→ `annotate-entry`，拍板 Q2：第二批）。
- emoji（→ `emoji-preference`）。
- 前端任何 UI 改动。
