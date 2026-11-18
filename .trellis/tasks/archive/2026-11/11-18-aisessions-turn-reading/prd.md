# AISessions 会话读取入口：探规模 + 按轮分页

## Goal

外部 agent（守夜人巡检、其它 MCP 客户端）要判一个会话「现在在做什么」，现在只能读 jsonl 尾部 64KB 原始记录，大半是工具输出，用户指令常在窗口外，只能退回去猜标题。本次给 AISessions 补一套**渐进式读取入口**：先探规模决定读法，再按「轮」分页，逐层下沉，永不一次拉全量。

设计全文：`design/plans/session-kernel-design-20261118.md`（第 2 节；原始出处：Hero 据点仓 `nita/hero-feaa3f86` `design/session-kernel-design-20261118.md` @ 274f8e56）

## Requirements

### R1 探规模门禁：`session info <id>`

返回一行元信息，**不含正文**：

| 字段 | 说明 |
|---|---|
| `messageCount` | 消息总数（复用 summary） |
| `userMessageCount` | user 消息数，一条 `COUNT(*)` 即可 |
| `bytes` | 文件大小（summary.Size） |
| `lastMessageAt` | 最后一条消息时间 |
| `verdict` | `small` / `medium` / `large` 分档，由上面几项推导 |

分档口径：`small` ≤150 条消息且 ≤2MB；`medium` 其他；`large` >1200 条消息或 >20MB。

**门禁写在接口层**：未调用 `info` 拿不到分档时，`turns`/`turn` 拒绝读消息（返回明确错误，而不是静默降级）。

### R2 四层渐进读取

| 层 | 命令 | 返回 | 体积上限 |
|---|---|---|---|
| 1 | `session users <id> --limit 20 --before-seq N` | 每条 user 消息 `seq/at/text(截 120 字)` | ~2KB |
| 2 | `session turns <id> --limit 5 --before-turn N` | 每轮 `turn/seq/at/user(截 120 字)/tools/chars/ms` | ~3KB |
| 3 | `session turn <id> --turn N --chars 2000` | 该轮原文消息 | ≤8KB |
| 4 | 已有 `Detail(loadAll)` | 完整会话分帧 512KB | 不动 |

**轮的定义**：一轮 = 一条 user 消息 + 之后直到下一条 user 消息之前的全部消息。轮号从 1 起递增。

游标统一 `nextBeforeSeq` / `nextBeforeTurn`，配 `hasMore`；翻页不重传已读内容。

### R3 UserOutline 改为 SQL 直查

现状 `UserOutline` 先 `manager.Load` 全量加载再内存筛（`latestUserOutlineMessages`）。改为 SQL：

```sql
SELECT seq, role, text, timestamp, tool_name, char_count
FROM ai_session_messages
WHERE session_key = ? AND role = 'user' AND seq < ?
ORDER BY seq DESC LIMIT ?
```

- 保留 `mtime`/`size` 失效检查：文件变了返回 `stale`，由调用方决定是否回填，不得静默返回旧行。
- 补索引 `idx_ai_session_messages_user ON ai_session_messages(session_key, role, seq)`。
- 保留现有 `UserOutline` RPC 的行为与 limit 约束（默认 20，上限 200），只是内部换实现。

### R4 CLI + MCP 双入口

- `wsh session info|users|turns|turn`（cobra 子命令，`--json` 与人类可读两态）
- MCP：`snorkeling_session_info` / `snorkeling_session_users` / `snorkeling_session_turns` / `snorkeling_session_turn`
- 两者共用同一 service 方法，参数与返回体一致。

### 约束

- 不得挂在 List 批量路径上：userline/turns 是单会话点查。List 的 128MB/5s 预算与 21s web 超时是本仓踩过的雷，不许碰。
- 不动 GUI 现有 detail 调用路径（`Detail` / `DetailDelta` / `UserOutline` 的对外签名与语义保持）。
- 不改 `ai_session_messages` 已有列；只加索引。

## Acceptance Criteria

- [ ] AC1 `wsh session info` 在 3 个不同规模会话上给出正确分档，输出 <1KB
- [ ] AC2 `session users` 一页 20 条、每条 ≤120 字，`nextBeforeSeq` 可连续翻到底且不重不漏
- [ ] AC3 `session turns` 的轮边界与"user 消息切分"一致：任取 3 个会话，人工比对首/中/末轮
- [ ] AC4 `session turn N` 只返回该轮消息，超过 8KB 时截断并标记 `truncated`
- [ ] AC5 未调用 `info` 直接调 `turns` 时返回明确错误（有测试覆盖）
- [ ] AC6 `UserOutline` 改 SQL 后：同一会话输出与改前逐字节一致；全量加载路径不再被触发（`explain` 或 debug 日志验证）
- [ ] AC7 4 个 MCP 工具与 CLI 参数/返回一致
- [ ] AC8 单测 + 现有 `aisessions` 测试全绿

## Notes

- 相关代码：`pkg/aisessions/sqlite_index.go`（索引与 `GetMessages`）、`pkg/aisessions/manager.go`（`Load`/`LoadDelta`）、`pkg/service/aisessionsservice/aisessionsservice.go`（`UserOutline` 在 1303 行附近）、`pkg/agentmcp/tools.go`（工具表）、`cmd/`（CLI 子命令）。
- 待拍板（原设计页 G2 第 1 问）：本次范围是否为「users + turns + info」，`turn`（第 3 层）可留到验证后。默认按建议：四层一起，`turn` 放最后。（已按设计稿 §8 Q1 落定）
- AC5 口径改写（见本目录 design.md §5，待确认）：RPC 无状态，服务端记不住「调过 info 没有」；改为「`turns` 必须显式传 `limit`（1–10）、`turn` 必须显式传 `chars`（≤8000），缺省/越界报错」，等价保证「绝不一次拉全量」。
- 阶段时长（大阶段/小阶段）不在本任务范围，见 `11-18-aisessions-card-phase-timeline`。
