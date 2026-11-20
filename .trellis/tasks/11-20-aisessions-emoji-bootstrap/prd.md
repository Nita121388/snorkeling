# Agent Block emoji 丢失修复：启动 bootstrap 后端 emoji + 停止撕本地账

## 背景（2026-11-20 现场定位）

v132（`2c94b2c6e`，11-19 22:04）把 session emoji 后端化后，前端 emoji 快照变成两层合并：

```
snapshot = { ...localEmojis(localStorage), ...backendEmojis(后端 props) }   // 后端优先
```

两层各有断点，导致「打开的 agent Block emoji 总是丢失」：

1. **本地层被主动清空**：`app.tsx` 挂载时跑 `migrateLegacySessionEmojis()`，抄到后端后
   `removeItem("snorkeling:agent-session-emojis")` + `localEmojis = {}`。
   所有窗口共用同一份 localStorage、同一 origin，因此**任何一个新窗口启动都会撕掉所有窗口的本地层**
   （其它窗口靠 `storage` 事件同步清空内存层）。→ 不重启也会丢。
2. **后端层没有启动灌入**：`backendEmojis` 的唯一生产者是 AI Sessions 列表响应
   （`aisessions.tsx:584` → `applyBackendSessionSummaries`，`limit: 200` + 项目/日期/标签筛选）。
   没打开过该列表的窗口，后端层永远是空对象。

现场证据（2026-11-20，CDP 直连运行中 app）：

- 后端 `ai_session_props` 里 emoji 行完好（`bee92d13` = 🧹，source=user）。
- 同一个会话的 open block 头部渲染的是 Pi 品牌 SVG（`agent-brand-icon` + `svg`），不是 emoji。
- 三个窗口共享的 localStorage key `snorkeling:agent-session-emojis` 为 `null`。

## 目标

- 任意窗口启动后，**无需打开 AI Sessions 列表**，agent Block 头部的 emoji 立即正确。
- 任何窗口启动/迁移动作**不得再清空其它窗口已有的 emoji**（运行中不丢）。
- 后端仍是唯一权威：后端值覆盖本地值；本地层退化为「离线/首次兜底」。

## 非目标

- 不改 `getAgentIcon` 的解析顺序（session → block meta → provider persona → 品牌 logo）。
- 不改 picker 的 scope 语义（session / block / provider）与写路径。
- 不做 emoji 的实时推送（WebSocket 层面）；本轮只解决「启动与本地层被清空」。
- 不改 AI Sessions 列表的 `limit` / 筛选逻辑。

## 需求

- R1 后端提供**全量 emoji props 读取**接口（一次调用返回所有 session 的 emoji），
  供前端在任何窗口启动时 bootstrap。
- R2 前端 store 增加/复用「后端层灌入」能力，bootstrap 结果合并进 `backendEmojis`。
- R3 迁移逻辑改为**只推不撕**：仍把 localStorage 的值按 if-absent 推给后端（幂等，保留历史迁移价值），
  但**不删除 localStorage key、不清空内存 localEmojis**。
- R4 空串陷阱加固：调用方传 `sessionId: ""` 时 `getAgentIcon` 仍应回落到 `meta["agent:sessionid"]`
  （现状用 `??`，空串不回落，meta 兜底失效）。

## 验收判据（必须可机器判定）

- A1 `go test ./pkg/aisessions/... -run Emoji` 全绿。
- A2 `go test ./pkg/wshrpc/... -run Emoji` 与 `go test ./pkg/agentcontrol/... -run Emoji` 全绿。
- A3 `npx vitest run frontend/app/agent-persona` 全绿，且新增用例覆盖：
  - bootstrap 灌入后 `getSessionEmojiSnapshot()` 含后端值；
  - `migrateLegacySessionEmojis()` 后 localStorage key **仍存在**、快照**不丢条目**；
  - `getAgentIcon(provider, {sessionId: "", meta: {"agent:sessionid": X}})` 命中 `X` 的 emoji。
- A4 真机/单体证据：新窗口启动后不打开 AI Sessions，agent Block 头部渲染 emoji 文本节点
  （`agent-brand-icon` 内含 emoji 文本而非品牌 `svg`）。以 CDP 或 vitest DOM 用例之一为准，
  在 implement.md 记录实际执行的是哪一条。

## 约束

- 不新增持久化介质（不引入新 store / 新表），复用 `ai_session_props.emoji`。
- RPC 必须走既有 wsh 命令注册模式（`wshserver` + `wshclient` + 前端 `wshclientapi.ts` + `gotypes.d.ts`），
  生成物与手写保持一致（参考 `sessionemojiget` 的现有形态）。
- 全量返回要设上限预算（emoji 行数量级 ~10^2），单次响应不得携带其它 props。
