# 技术设计：scoped token 与 MCP 门面

PRD：`prd.md`　母设计：`design/plans/agent-control-surface.md` §10.5
已落地（dd547bd4）：MCP 协议核心、12 工具、token 签发、link-scope 强制、`--token-file`。

## 1. 已落地的结构

```
pkg/agentscope/      observe<navigate<data 判定 + 命令→scope 表（唯一来源）
pkg/agentmcp/        MCP 协议（stdio JSON-RPC 2.0）+ 12 工具表 + Backend 接口
pkg/wshutil/
  wshscopes.go       linkId → scopes（绑连接，不信客户端自称）
  wshadapter.go      分发前按 cmd 查 scope 拒绝（E_FORBIDDEN）
  wshrouter_controlimpl.go  认证成功时 SetLinkScopes；外部 JWT 走 extractAgentJwtData
pkg/wavejwt          AgentName / Scope claims
pkg/wshrpc/wshserver/auth_commands.go  AgentAuthGrantCommand（应用内签发）
cmd/wsh/cmd/wshcmd-auth.go   wsh auth grant（0600 文件）
cmd/wsh/cmd/wshcmd-mcp.go    wsh mcp serve --stdio
```

## 2. 本片要补的四件事（按风险排序）

### 2.1 撤销（最高优先：没有它 token 只能等过期）

- 新包 `pkg/agentaccess`：登记表 `agent-data/agent-access/tokens.json`（0600）
  存 `{jti, name, scopes, expiresAt, createdAt, revokedAt}`，**不存 token 明文**。
- `AgentAuthGrantCommand` 写入登记；`extractAgentJwtData` 在验签后查
  `IsRevoked(claims.ID)`，命中即拒（错误码 `E_UNAUTHORIZED`）。
- `wsh auth revoke --name|--jti|--all`；`wsh auth list` 读登记表。
- 已认证的 live link：撤销后需要 `untrustLink`。首版先用「每次调用查登记表」的
  惰性失效（简单、无跨线程状态），吊销后下一次调用即失败——比主动断链更容易验证。

### 2.2 审计（§10.6）

- `<userdata>/agent-data/audit/control-audit.jsonl`，每行：
  `{ts, command, agentname, jtiPrefix, result}`。
- 写入点在**分发闸门**（`wshadapter` 的 scope 检查处）：被拒记 `denied`，
  通过记 `ok`（调用前记 `ok` 是近似——真正结果由 handler 决定；接受这个近似，
  因为审计的目的是「谁在什么时候动了什么」，不是复制响应码）。
- 只对 ACS 命令（`agentscope.RequiredForCommand` 命中的）记，不污染其它 RPC。

### 2.3 限流（按 jti）

- 令牌桶 `pkg/agentaccess/ratelimit.go`：每个 jti 默认 60 次/分钟。
- 超限 → `E_RATE_LIMITED`（新增冻结错误码？**不新增**：复用 `E_FORBIDDEN` 带
  hint，避免动 `agentcontrol/errors.go` 的冻结集合）。

### 2.4 L3 skill

- `skills/snorkeling-control/SKILL.md` + `reference/commands.md`（从 `wsh agent guide`
  同源摘录，避免漂移）+ `scripts/ensure-token.sh`。
- 红线（§10.5.6）必须原样写进 SKILL.md。

## 3. 关键取舍

| 取舍 | 理由 |
|---|---|
| 撤销用「惰性查表」而不是主动断链 | 无跨线程状态、可单测；断链留到有真实需求时 |
| scope 绑 link 而非读请求上下文 | 请求上下文由客户端提供，不可信 |
| MCP 工具表与 RPC 命令表分两处 | 工具名是产品语义（`snorkeling_ui_state`），命令名是传输语义（`uistate`）；用 `agentscope` 统一 scope 判定即可，不必强行合一 |
| 审计在闸门记 ok 而非 handler 内记结果 | 少侵入；handler 天然不感知「谁在调用」 |

## 4. 测试策略

- `pkg/agentaccess`：登记/撤销/过期/限流的纯逻辑单测。
- `pkg/agentmcp`：已有 10 例，追加「撤销后工具不可用」的闸门用例。
- 真机：AC2–AC5 需要 app 运行（外部 token 打真实实例）。
