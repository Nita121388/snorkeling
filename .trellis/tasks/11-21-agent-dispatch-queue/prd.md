# Agent 派发队列：异步投递 + 三段回执 + 统一入口（手机端就绪）

## 背景与问题

真机事故（2026-11-21）暴露两个问题：

1. **派发被做成了同步等待**：Overview 弹窗等"建块 + 等就绪 + 等确认"，最长 90 秒，把 UI 卡成"创建中"。
2. **送达没有权威状态**：pi 启动期（跑 `npm view` 查扩展更新）会冻结几十秒到几分钟，期间回车被吞；
   "输出增长"在启动期同样发生，导致两次误判 `confirmed=true`，模型从未收到消息。

方案 A（已提交 `c0b7fe080`）做了止血：前端派发不等待 + 后端"就绪门 + agentstatus hook 确认"。
本包在其上补齐**架构层**：派发是服务端持有的状态机，任何端（桌面 / CLI / MCP / 将来手机端）
只做"提交 + 读回执"。

## 参考（四个同类项目的共识）

| 项目 | 借鉴点 |
|---|---|
| herdr | 发送前按**状态**放行（blocked 直接拒），`agent wait` 等状态而不是等时间 |
| orca | `terminal send` 的**三段回执**（input-accepted → submitted → turn-started）+ 幂等重试 + 超时不自动重发 |
| paseo | provider 协议回执（turn_started + providerMessageId），派发与执行解耦 |
| t3code | SDK/stream-json 适配器，协议级 ack |

共识：**派发不等待、回执可查询、失败可重试且不重复**。

## 做什么（MVP）

### R1 派发记录与状态机

`dispatch` 记录字段：`dispatchid`、`blockid`、`tabid`、`text`（base64）、`requester`（desktop/cli/mcp/mobile）、
`state`、`createdat`、`updatedat`、`attempts`、`submitretries`、`error`。

状态：`pending → delivering → confirmed / failed`（failed 可 `retry` 回 pending）。

### R2 异步发送入口

`AgentSendCommand` 增加 `async: true`：建 dispatch 记录并入队，**立即**返回
`{ok:true, queued:true, dispatchid}`。后台 worker 复用现有同步投递链（ensure controller →
就绪门（启动标记消失）→ bracketed paste → 回车 → agentstatus hook ack → 有界补发）。
worker 使用独立 context（不随 RPC 结束时取消）。

### R3 回执查询

新增 RPC：
- `agentdispatchlist`（可选 `blockid` 过滤，返回最近 N 条）
- `agentdispatchget`（按 dispatchid）
- `agentdispatchretry`（failed → pending，幂等：同 dispatchid 不新建记录）

三段回执由记录字段体现：`acceptedat`（写入成功）→ `submittedat`（确认回车生效）→ `confirmedat`（hook 报 working/活跃）。

### R4 统一入口

桌面 Overview 弹窗、CommonText existing 路径改用 `async: true`；`wsh agent send --async`；
MCP `snorkeling_agent_send` 增加 `async` 参数。CLI/MCP 默认保持同步（向后兼容）。

### R5 前端最小可见性

Overview 面板与 agent 卡片只在**失败**时暴露：dispatch 记录 failed 时 `console.warn` + 后续（本包外）
接 OS 通知。成功不打扰。

## 不做什么

- 不改 agent 的 TUI 呈现（仍是终端块，用户可见）。
- 不做协议通道（方案 C：SDK/ACP）+ 不做状态清单 manifest（方案 D）——各自独立包。
- 不做手机端 UI 与推送链路本身；本包只保证**契约**（dispatch 记录 + RPC）可供手机端消费。
  手机端接入依赖 11-16 Websocket 推送地基，单独立项。

## 手机端约束（写进契约）

- 派发状态必须**服务端持有**，不能是前端 promise 或内存 UI 状态。
- 记录必须可按 `requester` 区分来源，手机端提交的派发与桌面同等可查。
- 回执字段用 snake-none（小写无下划线）JSON，便于跨端与同步层复用。

## 验收判据（机器可判定）

- [x] `go build ./...` → exit 0
- [x] `go test ./pkg/agentdispatch ./pkg/wshrpc/wshserver ./cmd/wsh/cmd` → 0 fail（状态机：pending→delivering→confirmed / failed→retry→pending / confirmed 终态 / 容量淘汰 / 列表过滤与排序）
- [x] `npx vitest run frontend/app/session-overview frontend/app/commontext` → 31 files / 449 tests 全绿
- [x] `npx tsc --noEmit` 本包文件 0 错；`npx eslint` 改动文件 exit 0
- [x] 真机（dev cdp 实例，2026-11-21 夜）：
  1. `async: true` 发送到刚新建的 pi 块 → **421~866ms** 返回，`queued=true`，`dispatchid=d-…`
  2. 轮询 `agentdispatchget` → `state=confirmed`，`submitretries=21`，accepted/submitted/confirmed 三段全 true；
     term 输出里出现**模型真实回答**（`AQ3` 出现在回答行，token 计数 `↑71 ↓3 R20k CH99.6%`，49KB 输出）
  3. 无效目标（不存在的块 / 非 term 块）→ 提交即报 `E_NOT_FOUND` / `E_BLOCK_NOT_READY`（快速失败，不入队）
     投递期失败（controller 起不来 / submit 超时未确认）→ 记录落 `state=failed` + `error`（代码路径 + 状态机单测覆盖）
- [ ] `wsh agent send --async --json` → 返回 `dispatchid`；`wsh agent dispatch list` 能看到该记录
      （CLI 已接线并通过 go test；端到端需 dev 实例的 JWT，当前实例 token 未取，留待收尾）

## 实现记录（2026-11-21 夜）

- `pkg/agentdispatch`：状态机 + 记录存储（容量 500，先淘汰终态旧记录）+ 单测 5 条。
- `pkg/wshrpc/wshserver/agentsend.go`：抽出 `deliverAgentSend`（同步/异步共用投递内核）；
  `AgentSendCommand` 增加 async 分支（建记录 + `go runAgentDispatch` + 立即返回）。
- `pkg/wshrpc/wshserver/agentdispatch_rpc.go`：`agentdispatchlist|get|retry` RPC + worker
  （`asyncQuietWaitMs=120s`、`asyncSubmitWaitMs=600s`、job 超时 30min；里程碑写三段回执）。
- **确认规则修正（本包最重要的真机教训）**：agent 块的提交确认**只认 hook**（`agent_start → working`）。
  「输出增长」在 pi 启动期同样发生，两次把未提交误判成 confirmed。非 agent 块（shell）才允许用输出增长。
- `wshrpctypes.go`：`AgentSendRequest.Async/Requester`、`AgentSendResult.Queued/DispatchId`、三个 dispatch 请求类型；
  `cmd/generatego` 导入表补 `agentdispatch`（否则 `task generate` 会重写出无 import 的 wshclient.go）。
- CLI：`wsh agent send --async`、`wsh agent dispatch list|get|retry`。
- 前端：Overview 弹窗 / CommonText existing 路径改 `async: true, requester: "desktop"`（提交即返回）。
- 手机端契约：记录含 `requester`，`agentdispatchlist` 可直接被将来的移动端消费；推送链路复用 11-16 Websocket 地基（不在本包）。

## 备注

- 前置：方案 A（`c0b7fe080`）：就绪门 + 派发不等待。
- 残留在途：`session-overview.tsx` 的 3 条 tsc 基线错误属 11-17 propRows 包，不在本包修。
