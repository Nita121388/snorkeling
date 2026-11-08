# 执行计划：scoped token + MCP（第二片）

第一片（dd547bd4）已交付：MCP 协议 + 12 工具 + token 签发 + link-scope 强制。

## 阶段 1：登记表与撤销

- [ ] 1.1 `pkg/agentaccess/store.go`：`Record` / `List` / `Revoke(name|jti|all)` / `IsRevoked(jti)`
- [ ] 1.2 `AgentAuthGrantCommand` 写登记（`jti` 来自 claims.ID）
- [ ] 1.3 `extractAgentJwtData` 查撤销 → 拒绝
- [ ] 1.4 `wsh auth list` / `wsh auth revoke`

验证：
```bash
go test ./pkg/agentaccess/ -run TestRecordRevokeList   # → ok
go build ./...                                          # → 0
```

## 阶段 2：审计

- [ ] 2.1 `pkg/agentaccess/audit.go`：`AppendAudit(entry)` 追加 jsonl（目录 0700、文件 0600）
- [ ] 2.2 `wshadapter` 闸门处：允许/拒绝各记一行（只记 ACS 命令）

验证：
```bash
go test ./pkg/agentaccess/ -run TestAuditAppend         # → 文件存在，行数 +1，含 agentname/jti 前缀
```

## 阶段 3：限流

- [ ] 3.1 `pkg/agentaccess/ratelimit.go`：按 jti 令牌桶，默认 60/min
- [ ] 3.2 闸门处超限 → 拒绝并带 hint

验证：
```bash
go test ./pkg/agentaccess/ -run TestRateLimit           # → 第 61 次失败
```

## 阶段 4：L3 skill

- [ ] 4.1 `skills/snorkeling-control/SKILL.md`（5 条红线原样）
- [ ] 4.2 `reference/commands.md`（与 `wsh agent guide` 同源摘录）
- [ ] 4.3 `scripts/ensure-token.sh`（缺失即提示 `wsh auth grant`，不绕过）

## 阶段 5：真机验收（需要 app 运行）

- [ ] AC1 `wsh auth grant` → 文件 0600
- [ ] AC2 外部 `wsh --token-file f ui active --json` → 成功
- [ ] AC3 同 token `block open` → `E_FORBIDDEN`
- [ ] AC4 `auth revoke --all` 后再跑 AC2 → 认证失败
- [ ] AC5 过期 token → `E_UNAUTHORIZED`
- [ ] AC6–AC9 MCP 协议（已有单测覆盖；真机补一次 stdio 握手）

## 判据总表

```bash
go test ./pkg/agentaccess/ ./pkg/agentmcp/ ./pkg/agentscope/   → ok
go build ./...                                                 → 0
node scripts/run-task.mjs generate                             → 只增不删
```
