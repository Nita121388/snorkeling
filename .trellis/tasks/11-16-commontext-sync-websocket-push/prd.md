> **Confirmed: 2026-11-16 @nita**

# CommonText 同步实时推送：WebSocket 通知 + 保存即触发 + timer 兜底

## Goal

CommonText 同步从「每 5 分钟定时」升级为「秒级」：服务端在数据变更时通过 WebSocket 广播 revision 通知，客户端收到通知立即触发一次增量同步；本地保存后 debounce 即触发上传；连不上 WebSocket 时自动退回现有 5 分钟 timer。面板「实时推送」从「不支持」变「支持」。

## Background

- 现状：`pkg/syncmanager/syncmanager.go:52` `DefaultInterval = 5 * time.Minute`，只有 timer + 手动两个触发源；一条修改跨设备可见最坏约 10 分钟。
- `syncproto.CapWebSocket` 常量已预留但无实现；`pkg/sync/transport_server.go` `Caps().Realtime = false`。
- 服务器 = `cmd/snorkeling-sync`（部署在 break.ccwu.cc，当前二进制 0.0.123）。

## Requirements

1. **服务端**（`cmd/snorkeling-sync`）
   - 新增已认证 WebSocket 端点；客户端连上后，服务端在任何 push 使 head rev 前进时向所有连接广播一条通知（至少含新 rev）。
   - `/v1/health` 的 `capabilities` 增加 `websocket`。
   - 通知不携带业务数据，只做「rev 变了，来拉」的信号；数据仍走 `/v1/snapshot` 增量拉取。
2. **协议**（`pkg/syncproto`）
   - 新增 WS 路径常量与通知消息结构；不 bump `ProtocolVersion`（纯增量，老客户端忽略即可）。
3. **客户端**
   - `pkg/syncclient` 增加 WS 连接能力（token 认证、ping/pong 保活）。
   - `pkg/sync/transport_server.go` `Caps().Realtime = true`，并提供可选 watch 能力。
   - `pkg/syncmanager`：server transport 且 health 显示 `websocket` 能力时启动常连接 goroutine；收到通知 → 防抖后 `SyncNow(ctx, "notify")`；断线指数退避重连（封顶），期间 timer 兜底不受影响；transport 切换/重载时停旧连接。
   - **保存即触发**：CommonText 本地写入路径（service Update / RenameTag / SyncResolve 等）调用 `syncmanager.Nudge()`：debounce（约 2s）后 `SyncNow(ctx, "save")`；未配置同步或正在跑时静默跳过。
   - `ErrAlreadyRunning`（engine 已在跑）一律视为良性：跳过即可，不记错误。
4. **前端**
   - 无需新 UI：设置面板实时推送徽标已有 `websocket` 能力判定，服务端上报后自动变「支持」。

## Constraints

- 老服务器（无 WS 端点，如现网 123）上客户端不得刷错误日志：dial 失败按退避处理并保持 timer 兜底。
- 不得引入第二个并发写入路径：所有变更仍收敛到 engine 单飞（`ErrAlreadyRunning` 已保证）。
- gorilla/websocket 已在 go.mod（v1.5.3），不引新依赖。
- 不改 `wsh` CLI 行为；`commontext-sync doctor` 输出新增一条 WS 检查项（可选，不阻塞）。

## Acceptance Criteria

- [ ] `go test ./cmd/snorkeling-sync/... ./pkg/sync/... ./pkg/syncclient/... ./pkg/syncmanager/...` 全绿。
- [ ] 服务端测试：连接 WS 后触发一次会前进 rev 的 push，客户端在 2 秒内收到含新 rev 的通知；不前进 rev 的 push 不广播。
- [ ] `/v1/health` capabilities 含 `websocket`；`transport_server.go` `Realtime=true`。
- [ ] syncmanager 测试：fake 通知触发 `SyncNow(trigger="notify")`；连接失败不 panic、不阻塞 timer。
- [ ] 保存路径测试：Nudge 后 debounce 窗口内只触发一次 `SyncNow(trigger="save")`；未配置同步时 no-op。
- [ ] 真机（或本机两实例）：A 保存 → B 在 journal 里出现 `trigger=notify` 的 run 且数据一致，时延 ≤2s（需要新二进制部署到服务器；未部署前以本机 server_test + syncmanager 测试为准，真机验收挂起并记录）。
- [ ] 对老服务器（无 WS）：客户端日志无错误风暴，timer 照常工作（单测覆盖 dial 404 分支）。
