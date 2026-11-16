# CommonText 同步实时推送契约（WebSocket 通知）

> 2026-11-16 落地。改动面：`pkg/syncproto`、`cmd/snorkeling-sync`、`pkg/syncclient`、`pkg/sync/transport_server.go`、`pkg/syncmanager`、`pkg/service/commontextservice`。

---

## 1. 通知只是信号，不是数据通道

- 服务端 `/v1/ws` 只广播 `syncproto.WSEvent{Type:"rev", Rev:N}`；**条目数据永远走 `/v1/snapshot?sinceRev=N`**。
- 理由：WS 丢包/断连只损失时效，不损失正确性；merge/conflict 逻辑只有一条路径。
- 判定：任何在 WS 上携带 item 内容的改动都是契约破坏。

## 2. `ProtocolVersion` 不因新增端点而 bump

capability + 端点属于纯增量：老客户端不认识 `websocket` 能力就不连；老服务器没有 `/v1/ws` 时新客户端退避回 timer。
bump 只用于**不兼容**的 wire 变更（见 `pkg/syncproto` 包注释）。

## 3. timer 永远在，watcher 只是加速器

- `DefaultInterval`（5 分钟）计时器不可删、不可被 watcher 取代。
- watcher 连续 3 次非网络错误（如老服务器返回 404/401）→ 停到下次 `reload()`，并且**每条 streak 只记一条日志**。逐次 log error 视为缺陷。

## 4. `ErrAlreadyRunning` 一律良性

`sync.Engine.Run` 单飞；timer / manual / notify / save 四路触发撞车时：

- `syncmanager.SyncNow` 用 `recordRunOutcome` 判定，benign 时**不写 `lastRunError`、不更新 `lastRunAt/lastResult`、返回 nil error**；
- service 层保存 nudge 与 watcher 通知都不得因撞车产生错误日志或面板红字。

## 5. 连接状态必须诚实

`syncclient.Client.Watch(ctx, onEvent, onConnected)` 的 `onConnected` 只在**握手成功后**调用一次；watch manager 只在那之后把 `Status.Realtime` 置真。
在 dial 之前或 dial 失败期间报 `Realtime=true` 属于契约破坏（面板会回答错的「已连」）。

## 6. 保存即触发只有一个入口

本地写入（`commontextservice.Update` / `RenameTag` / `SyncResolve` 成功后）只调 `syncmanager.Nudge()`：

- 2s debounce，窗口内多次调用合并成一次 `SyncNow(ctx, "save")`；
- 未配置同步时静默 no-op，不得阻塞或改变 RPC 返回值。

## 7. 判据（prove）

| 命令 | 期望 |
|---|---|
| `go test ./pkg/syncproto/... ./cmd/snorkeling-sync/... ./pkg/syncclient/... ./pkg/syncmanager/... -count=1` | 全 ok |
| `go test ./pkg/syncmanager/... -race -count=1` | ok |
| `curl $SERVER/v1/health` | capabilities 含 `websocket` |
| push 后 WS 客户端 | ≤2s 收到 `{"type":"rev","rev":N+1}` |
