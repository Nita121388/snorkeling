# Agent 上游错误（upstream_error）识别现状与改法

> 状态：**方案备忘，未开工**。2026-11-19 记录，待人工评审后再决定是否入 loop 队列。
> 结论先行：现在的状态机**能识别「出错了」，识别不出「是什么错」，而且 agent 因错终止后基本看不到错误状态**。

## 1. 真实案例

Agent Block 跑 pi（模型 `deepseek-v4.1-flash`，thinking `high`），终端里突然出现：

```json
{"code":9,"message":"safety check failed","type":"upstream_error"}
```

随后 agent 直接终止。block 头部 / 卡片 / 看板上最终看不到「出错」这个事实。

截图：`%LOCALAPPDATA%\snorkeling\Data\commontext-images\waveterm_paste_1795069138624_0aph4.png`
（截图里的文本用 Windows.Media.Ocr 提取核对过，JSON 无误。）

## 2. 现状识别链路

```
pi 扩展 (~/.pi/agent/extensions/snorkeling-agent-status.ts，由 pkg/agentstatus/hookinstall.go:piExtensionSource 生成)
  └─ wsh agentstatus <state> --provider pi --source hook|provider --reason ...
       └─ pkg/agentstatus/agentstatus.go（状态机：working/idle/blocked/error/rate-limited/stale/release）
            └─ publishAgentStatus → 前端 chip / 卡片 / 看板
```

关键事实（读代码确认，不是推测）：

- `pkg/agentstatus/agentstatus.go:21-22` 定义了 `StateError = "error"`、`StateRateLimited = "rate-limited"`。
- 全仓只有两处会产生这两个状态：`pkg/agentstatus/hookinstall.go:595/597`（pi 扩展的 `after_provider_response` 分支）和 opencode 插件（只有 working/idle/blocked）。
  **codex / claude 的 hook specs（`hookinstall.go:708-727`）完全没有 error 事件**。所以「上游报错」这条路目前**只有 pi 通**。
- 前端已经把 `status.reason` 拼进悬浮标题：`frontend/app/agent-status/agent-status-derive.ts:308`
  → 这意味着「显示 reason」这一层几乎不用改，问题在**上报的 reason 里没有有用信息**。

## 3. 三个盲区

| # | 盲区 | 代码位置 | 后果 |
|---|---|---|---|
| 1 | 上游错误体不解析，reason 只有 HTTP 状态码 | `hookinstall.go:597` `reason: "model-http-" + status` | `code:9 / upstream_error / safety check failed` 全丢；UI 只能显示泛化 error，用户看不出是安全拦截 |
| 2 | 会话终止会清掉错误状态 | `hookinstall.go:588` `session_shutdown → report("release")` | agent 因错退出时 release 立刻覆盖 error（error 虽有 60s TTL），最终呈现「正常结束」 |
| 3 | 流内错误（HTTP 200 + error body）完全漏掉 | `hookinstall.go:598` 2xx/3xx 走 `release` | 若上游把错误塞进 SSE 流里返回，不但识别不到，还会**顺手清掉已挂着的 error** |

## 4. 方案（已修正一个前提）

**修正点（重要）**：pi 的 `after_provider_response` 事件**只有 `status` + `headers`，没有 body**——
`@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:517-522`。

```ts
export interface AfterProviderResponseEvent {
    type: "after_provider_response";
    status: number;
    headers: Record<string, string>;
}
```

所以「在 HTTP 层解析错误体」这条路走不通，必须改用**流内错误事件**：

- `message_update` 事件带 `assistantMessageEvent`，其 `error` 变体带 `errorMessage` + `reason: "error"`
  （`@earendil-works/pi-ai/dist/api/pi-messages.d.ts:83-87`）。
- 现有扩展已经订阅了 `message_update`（`hookinstall.go:585`）做续期，**不需要新增订阅点**，加一个分支即可。

具体三处改动：

1. **扩展**：`message_update` handler 里加
   `if (ev.assistantMessageEvent?.type === "error")` → 取 `errorMessage`，截断（≤200 字符）后
   `report("error", "none", null, { ttlMs: ERROR_TTL_MS, source: "provider", reason: "model-error: " + truncated })`。
   正常 token 流上不 spawn、不 JSON.parse、不分配。
2. **扩展**：内存里记 `lastErrorReason`；`session_shutdown` 时若非空则 `report("error")` 而非 `release`，
   成功响应（2xx/3xx 分支）时清空。避免把正常收工误标成出错。
3. **前端**：`agent-status-derive.ts:308` 已经把 reason 拼进 title，只需确认 chip/看板的窄宽度下截断得当，
   大概率零改动。

## 5. 性能账

| 改动 | 热路径 | 影响 |
|---|---|---|
| 1 流内错误识别 | `message_update` 每 token 一次 | **近零**：只多一个同步字符串比较；handler 本来就每 token 跑（`renewWorking` 30s 限频早退）。错误分支才 spawn `wsh`，错误是低频事件 |
| 2 shutdown 改报 error | 会话关闭一次 | **零**：同样一次 `wsh agentstatus` 进程，只换 state 字符串 + 一个内存 flag |
| 3 前端 reason 展示 | 状态变更时重渲染 | **零**：chip 本来就按状态变化重渲染（不是按 token）；不新增订阅、不新增 timer |

即：**不影响性能**。要守的纪律只有三条——错误分支才 spawn、reason 必须截断、handler 保持全同步无解析。

## 6. 行为注意点（不是性能问题）

- pi 有自动重试（auto-retry）。错误可能马上重试成功，所以错误上报**保持现有的 60s 自清 TTL**（`ERROR_TTL_MS`），
  只是 reason 变具体，不要改成永驻。
- `session_shutdown` 改报 error 必须同时要求「最后一次 provider 交互是错误且未被成功清除」，
  否则会把正常收工的会话误标成出错。
- `tui-*` 之外的三面（block 头 / 卡片 / 看板）读的是同一份 chip view（`agent-status-chip-view.ts`），
  改一处即可三面一致，不需要分别改。

## 7. 待确认 / 未决

1. **DeepSeek 这个 `upstream_error` 到底走哪个通道**：HTTP 4xx/5xx，还是 HTTP 200 + 流内 error 事件？
   - 若 4xx/5xx → 盲区 1 是主因（reason 无内容）。
   - 若 200 + 流内 error → 盲区 3 是主因（完全漏掉，还会清状态）。
   - 影响改动 1 是否「必须」，但两条都应该做。
   验证方式：复现该错误时抓 `after_provider_response` 的 status（或看 pi session jsonl 里那条 assistant message 的 stop reason）。
2. 是否要引入独立的「出错终止」终态（区别于 `error` + TTL 自清），以便看板长期可见？
   现在 `error` 60s 后自动清，不适合「事后回看哪个 session 崩过」。
3. codex / claude 侧是否也要接 error 上报（目前完全没有该通路）。

## 8. 验收要点（若开工）

- 复现环境：构造一个会返回 4xx 的上游错误（或注入 mock provider），
  断言 `wsh agentstatus` 收到 `--reason "model-error: ..."`，且 chip title 里能看到该字符串。
- 断言 agent 因错退出后，block 头状态仍是 error（不是 idle/done）。
- 断言正常收工的会话不会被误标 error。
- 性能：改动前后同模型 token 吞吐无差异（handler 单次执行 <1µs 级），并跑对应验证台 area 留台账。

## 9. 相关代码坐标

| 文件 | 行 | 说明 |
|---|---|---|
| `pkg/agentstatus/agentstatus.go` | 21-22 | `StateError` / `StateRateLimited` 定义 |
| `pkg/agentstatus/agentstatus.go` | 449-455 | 停止续报（挂起/崩溃）时的过期衰减逻辑 |
| `pkg/agentstatus/hookinstall.go` | 570-573 | `THINK/TTL/RENEW` 常量 |
| `pkg/agentstatus/hookinstall.go` | 579-600 | pi 扩展的事件映射（`message_update` / `session_shutdown` / `after_provider_response`） |
| `pkg/agentstatus/hookinstall.go` | 708-727 | codex / claude hook specs（**无 error 事件**） |
| `frontend/app/agent-status/agent-status-derive.ts` | 308 | reason 已拼进 title |
| `frontend/app/agent-status/agent-status-chip-view.ts` | — | 三面共用 chip view（单点改） |
| pi `dist/core/extensions/types.d.ts` | 517-522 | `after_provider_response` 无 body 的证据 |
| pi-ai `dist/api/pi-messages.d.ts` | 83-87 | 流内 `error` 事件带 `errorMessage` |
