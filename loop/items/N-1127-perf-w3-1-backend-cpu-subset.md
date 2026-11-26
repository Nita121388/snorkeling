---
id: N-1127-perf-w3-1-backend-cpu-subset
title: "Wave 3-1（子集）: sysinfo 零订阅者门控 + RPC 反射缓存"
type: bug
priority: P1
severity: S2
status: open
origin: self
source: design/plans/snorkeling-perf-wave2-3-handoff-20261126.md §Wave 3 包 4 子集
task: 11-27-perf-w3-1-backend-cpu-subset
order: 100
touch: [pkg/wshrpc/wshremote/sysinfo.go, pkg/wshutil/wshadapter.go, pkg/wstore/wstore_rtinfo.go, pkg/wshserver/, loop/**, .trellis/tasks/11-27-perf-w3-1-backend-cpu-subset/**]
rollback: null
budget: {minutes: 150}
releaseCandidate: false
createdAt: "2026-11-27T00:40:00Z"
---

# Wave 3-1（子集）: 后端降 CPU

## 背景

sysinfo 每 1s 无条件全链路采集推送（0 订阅者也推）；findCmdMethod 每次 RPC 线性反射扫描；
SetRTInfo 每次持全局锁重建 json tag 反射 map。W3-1 其余子项与 W3-2（索引 P1/P2 依赖
Windows 大库基准）不在本包。

## 验收判据

- [x] `go test -p 1 -race ./pkg/wshutil/... ./pkg/wstore/... ./pkg/wshrpc/... && echo W3_1_GO_OK` → `W3_1_GO_OK`（全 ok，主 agent 复跑一致）
- [x] `go build ./... && echo W3_1_BUILD_OK` → `W3_1_BUILD_OK`
- [x] 红测转绿（findCmdMethod 同指针：HEAD 运行时红 0x...9b0 vs 0x...af0；rtinfo tag 缓存：HEAD 编译红 undefined；sysinfo 门控：HEAD 编译红 undefined）
- tsc 57 = 基线（纯 Go，零前端改动）

## 记录

- 红证：`.trellis/tasks/11-27-perf-w3-1-backend-cpu-subset/red-proof.txt`（子代理采集：R2 运行时红 / R3 编译红 / R1 编译红）
- sysinfo 门控结论：订阅记账只在主服务器 wps.Broker（HasSubscribers 现成 API）；本地循环可判定 → 0 订阅跳过采集推送；**远端 connserver 订阅状态物理不可见 → fail-open 恒推送**（砍远端需新增主→远端订阅转发 RPC，另立工作项）；event 级门控方向安全（只可能多推）。
- findCmdMethod 缓存返回共享 *reflect.Method 指针（调用方只读）。
- 遗留：远端 sysinfo 订阅转发 RPC（需动 wshrpctypes.go + tsgen）；W3-1 其余子项（PTY base64 / Codex 捕捉轮询 / VCS 串行 git）与 W3-2 索引 P1/P2（需 Windows 大库）移交用户机器。
