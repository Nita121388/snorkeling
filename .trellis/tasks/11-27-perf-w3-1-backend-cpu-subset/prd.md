# Wave 3-1（子集）: sysinfo 零订阅者门控 + RPC 反射缓存

> 来源：`design/plans/snorkeling-perf-wave2-3-handoff-20261126.md` §Wave 3 包 4（W3-1）的低风险子集。
> W3-1 其余子项（PTY base64 广播 / Codex 会话捕捉 29 分钟轮询 / VCS 串行 git 合批）与
> W3-2（AI Sessions 索引 P1/P2 —— 依赖用户 Windows 机器的 3.42GB 大库基准与验证）均不在本包。

## Goal

砍掉三处"0 用户动作也持续烧 CPU"的后端路径：sysinfo 零订阅者仍每秒全链路采集推送、每次 WS RPC 命令线性反射扫描百余方法、`SetRTInfo` 每次持全局锁重建 json tag 反射 map。

## Requirements

- R1 `pkg/wshrpc/wshremote/sysinfo.go` `RunSysInfoLoop`：本机与所有远端每 1s 无条件 `generateSingleServerData`（采集 CPU/Mem + 序列化 + EventPublishCommand 全链路推送），即使 **0 个订阅者**。改造为 tick 前检查订阅状态：该 conn/scope 的 sysinfo 事件无订阅者 → 跳过采集与推送（循环本身保留）。订阅查询用服务端既有机制（研究 StreamBroker / EventSub 状态；若无现成 API，在 `pkg/wshserver` 或 wshremote 内做一个小型 scope 订阅计数器，EventSub/EventUnsub 时维护；注意 W2-3 客户端已把订阅合批为每 eventType 一条，服务端语义不变）。
- R2 `pkg/wshutil/wshadapter.go` `findCmdMethod`：每次 RPC 调用线性 `rtype.NumMethod()` 扫描。加 per-`reflect.Type` 的 `cmd → *reflect.Method` 缓存（并发安全：sync.Map 或 RWMutex map；返回**同一指针**）。
- R3 `pkg/wstore/wstore_rtinfo.go` `SetRTInfo`：每次调用重建 `jsonTagToField` map（持全局锁）。把 json tag → field index 映射按 `reflect.Type` 缓存（包级 sync.Map 或 init once per type），SetRTInfo 只查缓存。

## Acceptance Criteria（机器判定）

- [ ] 红测转绿：`go test ./pkg/wshutil/... ./pkg/wstore/... -run 'FindCmdMethod|RTInfo'`（红测：findCmdMethod 两次调用返回同一 method 指针；rtinfo 的 tag 映射缓存存在性——以子代理设计的可红绿翻转的测试为准，红证落 `.trellis/tasks/11-27-perf-w3-1-backend-cpu-subset/red-proof.txt`）。
- [ ] sysinfo 门控单测：无订阅者 → tick 不采集不推送；有订阅者 → 采集推送（注入时钟/收集器断言）。
- [ ] `go test -p 1 -race ./pkg/wshutil/... ./pkg/wstore/... ./pkg/wshrpc/...` 全绿。
- [ ] `go build ./...` 通过。
- [ ] `node scripts/check-tsc-baseline.mjs`（若本包只动 Go 则必然 57 = 基线）。

## 风险

- sysinfo 门控若订阅状态源不可靠（如客户端 NoResponse 订阅的记账遗漏），会导致 UI 无数据 → 门控条件保守：无订阅状态信息时**默认推送**（fail-open），只在明确 0 订阅时跳过。
- findCmdMethod 缓存必须并发安全（多 goroutine RPC）。
- SetRTInfo 的 type 缓存 key 是 `reflect.Type`（指针可比较，安全）。
