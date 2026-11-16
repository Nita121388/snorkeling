# Implement — CommonText 同步实时推送

执行顺序：协议 → 服务端 → 客户端库 → transport → syncmanager → service 触发点 → 测试补全。每步后跑对应测试再进下一步。

## 1. 协议层 `pkg/syncproto/syncproto.go`

- [ ] `WSPath = "/v1/ws"` 常量 + `WSEvent{Type, Rev}` 结构（见 design §1）
- [ ] 单测：WSEvent JSON 序列化形状（`{"type":"rev","rev":42}`）

## 2. 服务端 `cmd/snorkeling-sync`

- [ ] 新 `hub.go`：Hub（Register/Broadcast，写失败即断开）
- [ ] `main.go`：`handleWS`（requireAuth 包裹 → Upgrade → 注册 → ping/读循环）；路由挂 `syncproto.WSPath`
- [ ] `handlePush`：Apply 后 `resp.Rev > 旧 head` 才 Broadcast
- [ ] `handleHealth`：capabilities += `websocket`
- [ ] 测试（server_test.go）：httptest + gorilla dial：连上 → 触发前进 rev 的 push → 2s 内收到含新 rev 的 WSEvent；unchanged push 不广播；无 token 握手 401

## 3. 客户端库 `pkg/syncclient/client.go`

- [ ] `Watch(ctx, onEvent)`：wss/ws 按 BaseURL scheme 推导；Authorization header；ping/pong；断开返回 err
- [ ] 测试：用 httptest server 起假 WS 端点，验证事件回调 + 断开返回

## 4. transport `pkg/sync/transport_server.go`

- [ ] `Caps().Realtime = true`（注释更新：watcher 由 syncmanager 持有 Client 实现）

## 5. syncmanager `pkg/syncmanager/watcher.go`（新）+ `syncmanager.go`

- [ ] `watcher.go`：startWatcher/stopWatcher；Watch 循环 + 指数退避（1s→30s 封顶，成功重置）；notify channel（容量 1）+ 500ms 防抖 → `SyncNow(ctx,"notify")`；`ErrAlreadyRunning` 静默
- [ ] `reload()`：server transport 且能力含 websocket（由 ProbeConfiguredServer 结果或首连成功判定）时启动；transport 切换时 stopWatcher
- [ ] `Status` 加 `Realtime bool`
- [ ] `Nudge()`：2s debounce → `SyncNow(ctx,"save")`；未配置 no-op；窗口内合并
- [ ] 测试：fake client 注入——notify 触发 trigger=notify 的 run；Nudge 合并只触发一次；未配置时 no-op；dial 失败不 panic 不阻塞 timer

## 6. 保存触发点 `pkg/service/commontextservice/commontextservice.go`

- [ ] `Update` / `RenameTag` / `SyncResolve` 成功后调 `syncmanager.Nudge()`（不阻塞返回，错误吞掉记日志）

## 7. 收尾验证

- [ ] 全量：`powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./cmd/snorkeling-sync/... ./pkg/sync/... ./pkg/syncclient/... ./pkg/syncmanager/... ./pkg/service/..."`
- [ ] `go vet` 干净；改动的包 lint 过
- [ ] 手工真机（需新二进制部署 break.ccwu.cc，**挂起项**：部署是人工步骤，记录到 task notes；部署后验收 A 保存 → B journal 出现 trigger=notify）
- [ ] commit：`feat(sync): CommonText 实时推送（WebSocket rev 通知 + 保存即触发 + timer 兜底）`

## 回滚点

- 每个 section 一个独立可 revert 的小步；最终单 commit，revert 即回滚。
- 风险最高的是 §5（goroutine 生命周期）：stop 必须等 goroutine 退出，防泄漏；test 里用 -race。

## 判据（prove 用）

| 命令 | 期望 |
|---|---|
| `go test ./cmd/snorkeling-sync/...` | ok，含 WS 广播测试 |
| `go test ./pkg/syncmanager/... -race` | ok，notify/save 触发测试 |
| 启 server + curl `/v1/health` | capabilities 含 `websocket` |
| push 后 WS 客户端 | 2s 内收到 `{"type":"rev","rev":N+1}` |

---

## 执行结果（2026-11-16）

全部 7 个 section 已完成，单 commit 提交。测试：`syncproto / cmd/snorkeling-sync / sync / syncclient / syncmanager / service/commontextservice` 全 ok；`syncmanager -race` ok。

落地时额外修了两处（`trellis-check` 未覆盖，主 agent 复核发现）：

1. `ErrAlreadyRunning` 原本会被写进 `lastRunError` 并返回错误 → 提取 `recordRunOutcome`，benign 时什么都不记、返回 nil（契约见 `.trellis/spec/snorkeling-docs/backend/commontext-sync-realtime-contract.md` §4）。
2. `Status.Realtime` 原本在 dial 之前就置真 → `syncclient.Watch` 增加 `onConnected` 回调，只在握手成功后置真（契约 §5）。

**挂起项（G7 人验收）**：`break.ccwu.cc` 上跑的仍是 0.0.123 的老二进制（无 `/v1/ws`），需人工 `go build -ldflags "-X main.buildAppVersion=<ver>" ./cmd/snorkeling-sync` 并部署重启后，才能做端到端验收：A 保存 → B journal 出现 `trigger=notify`、时延 ≤2s。部署前本包以单测为准。
