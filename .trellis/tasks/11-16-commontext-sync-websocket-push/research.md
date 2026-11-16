# Research — CommonText 同步现状（代码证据）

本文件是动手前的现状踏勘记录，给实现者/检查者当上下文用。

## 触发源（现状）

- `pkg/syncmanager/syncmanager.go:52` — `DefaultInterval = 5 * time.Minute`
- `pkg/syncmanager/syncmanager.go:121` `loop()` — 每 tick `reload()` + `SyncNow(ctx, "timer")`
- `pkg/service/commontextservice/commontextservice.go:209` — 唯一的手动入口 `SyncNow`（`trigger` 由调用方给，前端设置面板传 `"manual"`）
- 保存路径**没有任何** sync 触发（grep `syncmanager` 在本 service 里只有 SyncNow/SwitchTransport/Status/JournalTail 调用）

## 引擎串行化

- `pkg/sync/engine.go:275` `Run()` — `e.running` 标志 + `ErrAlreadyRunning`，第二次并发调用直接返回错误。所以 notify/save 触发撞车是良性的。

## Caps

- `pkg/sync/engine.go:44` `Caps{RequiresCredential, AtomicWrite, Incremental, Realtime}`
- `pkg/sync/transport_server.go:38-46` — `Realtime: false`，注释写明「Realtime (WebSocket) is not implemented yet」
- `pkg/sync/transport_folder.go:74` / `transport_git.go:74` — 也都是 `Realtime: false`

## 协议

- `pkg/syncproto/syncproto.go:27` `ProtocolVersion = 1`
- `syncproto.go:36` `HealthPath = "/v1/health"`；`syncproto.go:39` `SnapshotPath = "/v1/snapshot"`（GET 拉 / PUT 推）
- `syncproto.go:54-59` capability 常量：`CapSnapshot` / `CapIncremental` / `CapWebSocket`（`CapWebSocket` **全仓无消费方**，只有声明）
- `Health.Capabilities []string` 已在 wire 上，前端 `syncsettings.tsx` 按它渲染实时推送徽标

## 服务端

- `cmd/snorkeling-sync/main.go:104` — `Server{store, tokens}`；路由：`/v1/health` 匿名、`/v1/snapshot` 走 `requireAuth`
- `cmd/snorkeling-sync/main.go:196` `handleHealth` — `Capabilities: []string{CapSnapshot, CapIncremental}`
- `cmd/snorkeling-sync/store.go:170` `Apply()` — 事务内推进 `newRev`，`setHeadRevTx` 后 commit；返回 `PushResponse.Rev`
- token 校验在 `requireAuth` 包装（Bearer header），WS 握手同属 HTTP，可复用

## 依赖

- `go.mod:17` `github.com/gorilla/websocket v1.5.3` 已在（桌面端 `pkg/web/ws.go` 在用）
- `cmd/snorkeling-sync` 目前没有 Taskfile / CI 构建目标（手工 `go build`）

## 前端

- `frontend/app/view/waveconfig/syncsettings.tsx:863` 区域按 `serverHealth` 渲染版本/数据/认证/实时推送四行
- i18n：`waveconfig:sync.serverStatus.realtimeSupportedDesc`（「服务器已支持 WebSocket 推送…」）/ `realtimeUnsupportedDesc`（「服务器传输尚未实现…」）
