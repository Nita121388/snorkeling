# Design — CommonText 同步实时推送

## 边界与不变量

- **通知只是信号，不是数据通道**：WS 消息只带 `{type, rev}`；数据一律走 `/v1/snapshot?sinceRev=N` 增量拉取。这样 WS 断了/丢了只损失时效，不损失正确性。
- **Engine 仍单飞**：`sync.Engine.Run` 已用 `running` 标志 + `ErrAlreadyRunning` 串行化。notify/save 触发的 `SyncNow` 撞上正在跑的 run 直接静默跳过——不排队、不重试（下一个信号会再触发）。
- **timer 永远在**：WS watcher 是加速器不是替代品；5 分钟 timer 原样保留，作为 watcher 挂掉的兜底。
- **协议不 bump**：`ProtocolVersion = 1` 不动。新增端点 + capability 是纯增量；老客户端（不认识 `websocket` capability）行为不变，老服务器（无 `/v1/ws`）上新客户端按退避处理。

## 各层改动

### 1. `pkg/syncproto`（协议）

```go
// WSPath 是已认证的 WebSocket 通知端点。
const WSPath = "/v1/ws"

// WSEvent 是服务端向已连接客户端广播的通知。只做信号，不携带条目数据。
type WSEvent struct {
    Type string  `json:"type"` // 目前只有 "rev"
    Rev  float64 `json:"rev"`
}
```

### 2. `cmd/snorkeling-sync`（服务端）

新文件 `hub.go`：

```go
type Hub struct {
    mu   sync.Mutex
    conns map[*websocket.Conn]struct{}
}
func (h *Hub) Register(c *websocket.Conn) func()  // 返回注销函数
func (h *Hub) Broadcast(ev syncproto.WSEvent)      // 非阻塞写，写失败即断开该连接
```

`main.go` / `server`：

- `mux.HandleFunc(syncproto.WSPath, srv.requireAuth(srv.handleWS))`；`handleWS` 用 gorilla `websocket.Upgrader` 升级，注册进 Hub，循环 `Ping`/读（只丢弃）直到断开。
- `handlePush`：`Apply` 返回后，若 `resp.Rev > 请求前 headRev`，`hub.Broadcast(WSEvent{Type:"rev", Rev: resp.Rev})`。注意：只在 rev 前进时广播（unchanged-only push 不广播）。
- `handleHealth`：`Capabilities` 追加 `syncproto.CapWebSocket`。
- `requireAuth` 复用现有 token 校验（WS 握手用 HTTP header，`Authorization: Bearer` 原样可用）。

### 3. `pkg/syncclient`（客户端 HTTP/WS）

```go
// Watch 建立到 <WSPath> 的 WebSocket 连接（https→wss, http→ws），
// 每收到一条 WSEvent 调一次 onEvent；连接错误/断开返回 err，由调用方决定重连。
func (c *Client) Watch(ctx context.Context, onEvent func(syncproto.WSEvent)) error
```

- gorilla `websocket.Dialer`，header 带 `Authorization: Bearer <token>`。
- 读循环里处理 `Ping`→`Pong`；实现方（syncmanager）负责退避重连。

### 4. `pkg/sync`（transport 层）

- `transport_server.go` `Caps().Realtime = true`。
- 不在 Transport 接口上加方法（引擎不感知实时性）；watch 由 syncmanager 直接持有 `*syncclient.Client`（`ServerTransport.Client` 已导出）。

### 5. `pkg/syncmanager`（进程级编排，核心）

新文件 `watcher.go`：

```go
// startWatcherLocked: transport==server 且（探得）health.capabilities 含 websocket 时启动
//   - goroutine: 循环 Client.Watch(ctx, onEvent)
//   - onEvent -> notifyCh（容量 1，合并风暴）
//   - 另一 goroutine: notifyCh → 防抖 500ms → SyncNow(ctx, "notify")（ErrAlreadyRunning 跳过）
//   - Watch 返回错误 → 指数退避重连 1s,2s,4s...30s 封顶；成功后重置
// stopWatcher: cancel ctx，等 goroutine 退出
```

- `reload()` 构建 server engine 时：能力未知时先不连（避免每个 tick 都 dial），首次由 `ProbeConfiguredServer` 或一次后台 health 决定是否 `startWatcher`；能力不含 websocket 或 dial 连续失败 N 次（如 3 次非网络错）→ 停止 watcher 直到下次 reload。
- `Status` 增加 `Realtime bool`（watcher 连着 = true），供 UI/journal 观测。

保存即触发 `Nudge()`：

```go
// Nudge 由本地写入路径调用：debounce 2s，触发 SyncNow(ctx, "save")。
// 未配置同步/正在跑 → 静默跳过；重复 Nudge 在窗口内合并为一次。
func Nudge()
```

- 触发点：`pkg/service/commontextservice` 的 `Update` / `RenameTag` / `SyncResolve`（写本地库的 RPC 成功后）。直接 import syncmanager（同进程包，无环：commontextservice 已 import syncmanager）。

### 6. 前端

零改动：设置面板已按 `health.capabilities` 含 `websocket` 渲染「支持」（`syncsettings.tsx` realtimeSupported/realtimeUnsupported 逻辑已有）。`Status.Realtime` 暂不接 UI。

## 数据流（正常路径）

```
设备A 保存 item → service.Update → syncmanager.Nudge() --2s--> SyncNow("save") → PUT /v1/snapshot
服务器 Apply → rev 前进 → hub.Broadcast(WSEvent{rev})
设备B Watcher.onEvent → 防抖 → SyncNow("notify") → GET /v1/snapshot?sinceRev → 应用到本地库
```

## 权衡记录

- **只广播 rev，不推数据**：避免 WS 上的部分写/乱序问题，复用全部既有 merge/conflict 逻辑；代价是多一次 HTTP 往返（可接受，目标本来就是 ≤2s）。
- **notify/save 触发撞车不管**：engine 单飞天然合并；风暴信号用「容量 1 的 channel + 防抖」合并。
- **不做 server→folder/git transport 的实时**：那些 Caps().Realtime 仍为 false，watcher 只在 server transport 下启动。
- **doctor 暂不加 WS 检查项**：避免本包范围膨胀；health capabilities 已可观测。

## 回滚

单 commit（+测试）。回滚 = revert；老服务器无 WS 端点时新客户端自动退避回 timer，无需服务端回滚。
