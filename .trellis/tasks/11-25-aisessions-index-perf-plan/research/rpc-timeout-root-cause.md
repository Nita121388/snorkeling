# Summary 503 / LiveSessionState 断连根因报告

> 只读源码调查；未改代码、未操作数据库、未启动/停止应用。
> 结论分「代码证实 / 强推断 / 待运行时证据」。

## 1. 已证实机制

### HTTP 层

- `/wave/` 统一套 `http.TimeoutHandler`，默认 21s，可由 `web:servicetimeoutms` 调到 60s：`pkg/web/web.go:59-86,548-550`。
- `http.Server.WriteTimeout` 固定 21s：`pkg/web/web.go:576-580`。
- `handleService` 把请求 context 传给 `service.CallService`：`pkg/web/web.go:141-169`。

因此同一慢请求会有两种表象：

1. TimeoutHandler 先完成：HTTP **503**，body `"Timeout"`（约 0.1kB）。
2. WriteTimeout 先关闭 socket：浏览器 **ERR_EMPTY_RESPONSE**。

### Summary 链路

- 前端 60s 轮询使用 `refresh:false`：`frontend/app/view/aisessions/aisessions.tsx:1486-1495,1760`。
- `Summary(false)` 走 `resolveSession(..., allowStale=true)`：`pkg/aisessions/manager.go:860-875`。
- 解析顺序：live registry → SQLite（允许 stale）→ **全量扫描**：`pkg/aisessions/manager.go:1557-1587`。
- SQLite 命中路径只查 `ai_sessions`/meta，不碰消息正文：`pkg/aisessions/sqlite_index.go:2005-2052`。
- miss 时 `refreshAllSummaries → ScanAllSummaries`：`pkg/aisessions/manager.go:319-337`。

### 扫描预算与 join

| 角色 | context | 预算 | 取消等待 |
|---|---|---:|---|
| joiner | HTTP ctx | 无独立预算 | 是 |
| leader | `context.Background()` | 默认 8s | 否 |
| List 后台 scan | `context.Background()` | 60s | 否 |
| `Summary(refresh=true)` 后台 refresh | `context.Background()` | 120s | 否 |

证据：`pkg/aisessions/scancoordinator.go:227-280`、`pkg/aisessions/manager.go:51-54,222-224,344-364,1509-1533`。

**竞态**：List 冷扫描启动 60s flight → Summary miss join → HTTP 21s 先取消/超时 → 503 或空响应。共享扫描必须继续跑，不能因单个 RPC 取消而中止（既有契约）；正确修复是请求侧独立短预算。

### LiveSessionState 两条路径

1. **live GUI chat**：`GetState(ctx)` 忽略 ctx，`rpc.Send` 固定 30s：`pkg/aisessions/chat/session.go:291-309`、`pkg/aisessions/chat/rpcprocess.go:43-48,144-160`。已超过 HTTP 21s。
2. **disk fallback**：`CurrentModelState → Summary(false)` 可 join 长 scan；tail miss 后 `manager.Load` 可全量读正文并触发 SaveMessages：`pkg/aisessions/types.go:261-274`、`pkg/service/aisessionsservice/chatcontrol.go:93-145`、`pkg/aisessions/manager.go:1424-1498`。

### 次级放大

- `Summary(refresh=true)` 走 `Manager.Refresh → RefreshSummaries → ScanSummaries`，绕过 `ScanAllSummaries` single-flight，可能与 List scan 并发：`pkg/aisessions/manager.go:672-684`、`pkg/aisessions/sqlite_index.go:1599-1603`、`pkg/aisessions/providers.go:13-40`。
- 每次打开 SQLite 都执行 PRAGMA/schema DDL 检查，锁竞争时放大尾延迟：`pkg/aisessions/sqlite_index.go:52-68,99-131`。

## 2. 性能基准对根因的约束

副本实测：

- 列表摘要 P50 **103.438ms**。
- 单会话元数据 P50 **0.332ms**。
- 最大会话 turn starts P50 **30.338ms**。
- 最大正文详情 P50 **39.072ms**。

所以缓存命中的 Summary SQL 不可能是 43.65s 主因。43.65s 更可能来自 provider 全量扫描/长 flight join/`GetState` 30s/回退叠加，但需要运行时阶段耗时才能定案。

## 3. 最小零功能回退修复

1. `Summary(false)` miss 不 join 60s/120s flight；请求侧独立预算（初始建议 1.5s），超时快速返回可重试错误/pending。
2. 无 flight 时保留 8s 同步扫描或转后台立即 pending。
3. `GetState` 真正响应 context；`JsonlRpcProcess.Send` 提供 context-aware 路径。
4. `LiveSessionState` 整体 best-effort 有界；超时保持现有 `{live:false}`，前端已保留 requested model。
5. `Summary(refresh=true)` 与 List scan 统一协调。
6. Detail 的 `allowStale=false` 不放宽。

## 4. 缺失测试

- 长 flight join 的短 deadline 返回 + 共享扫描仍完成。
- leader 请求取消不中止后台扫描。
- `GetState` 短 deadline 不等满 30s。
- `LiveSessionState` 冷启动不产生 503/空响应。
- `CurrentModelState` miss 不触发全量 Load/SaveMessages。
- refresh 与 List scan 并发时 provider 扫描次数为 1。
- HTTP 内部预算集成测试。

## 5. 证据边界

- **代码证实**：调用链、SQL 形状、context 语义、21s/30s/60s/120s 预算、503/空响应生成机制。
- **强推断**：本次 Summary 503 命中长 flight join；LiveSessionState 命中 GetState 或 scan join。
- **待证实**：43.65s 各阶段精确耗时、运行时 `web:servicetimeoutms`、SQLite busy wait 参与度。
