---
id: F-1116-commontext-sync-ws-push
title: "CommonText 同步实时推送：WebSocket rev 通知 + 保存即触发 + timer 兜底"
type: arch
priority: P1
status: open
origin: self
source: "2026-11-16T06:45:44Z"
task: 11-16-commontext-sync-websocket-push
order: 100
touch:
  - pkg/syncproto/syncproto.go
  - pkg/syncproto/syncproto_test.go
  - cmd/snorkeling-sync/hub.go
  - cmd/snorkeling-sync/main.go
  - cmd/snorkeling-sync/server_test.go
  - pkg/syncclient/client.go
  - pkg/syncclient/client_test.go
  - pkg/sync/transport_server.go
  - pkg/syncmanager/syncmanager.go
  - pkg/syncmanager/watcher.go
  - pkg/syncmanager/syncmanager_test.go
  - pkg/service/commontextservice/commontextservice.go
rollback: revert 单 commit；老服务器无 WS 端点时客户端自动退避回 timer，无需服务端回滚
budget: {minutes: 90, retries: 2}
releaseCandidate: false
createdAt: "2026-11-16T06:45:44Z"
---

# CommonText 同步实时推送：WebSocket rev 通知 + 保存即触发 + timer 兜底

## 背景

CommonText 同步现只有 5 分钟 timer + 手动两个触发源，跨设备可见最坏 ~10 分钟。设置面板「实时推送」显示不支持（`CapWebSocket` 只有常量声明，全仓无实现）。用户要求做实时推送。

## 来源

- self：用户在会话中确认（"ok go"），Trellis 任务 `.trellis/tasks/11-16-commontext-sync-websocket-push`（prd/design/implement 三件套已落）。

## 验收判据

- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./cmd/snorkeling-sync/... ./pkg/sync/... ./pkg/syncclient/... ./pkg/syncmanager/... ./pkg/service/..."` → 全部 ok，期望 0 失败
- `go test ./pkg/syncmanager/... -race -count=1` → ok，期望 0 失败
- 服务端 WS 测试：连上后触发一次前进 rev 的 push → 期望 2 秒内收到含新 rev 的通知（事件 `rev` 断言）
- `/v1/health` capabilities 断言含 `websocket`
- 真机判据（部署 break.ccwu.cc 后人工验收，G7）：A 保存 → B journal 出现 `trigger=notify`，≤2s

## 记录

- 2026-11-16：G1/G6 依据 = 用户在会话中看过三件套并连说两次 go（"ok go" / "go on"）。
- 2026-11-16：G1/G2/G5/G6 全清；实现 + 测试全绿（含 `-race`）；新增契约 `.trellis/spec/snorkeling-docs/backend/commontext-sync-realtime-contract.md`。G7 待部署新 server 二进制后人工验收。
