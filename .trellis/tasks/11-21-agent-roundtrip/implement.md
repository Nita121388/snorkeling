# Agent Roundtrip · 执行计划

门链：G1（人签 prd）→ G2（红证）→ 实现 → G5 → G7（人验收）。与 11-21-agent-resume 无依赖，可并行（同改 `tools.go` / `wshcmd-session.go`，串行落地更稳）。

## 0. 前置

- [ ] 0.1 `queue run --id F-1121-agent-roundtrip --dry-run` 门清
- [ ] 0.2 `task.py start 11-21-agent-roundtrip`

## 1. G2 红证

- [ ] 1.1 `replyComplete` 矩阵单测（6 组：全齐 / 只 idle / 只文件变 / 只 turn 增 / 全不齐 / blocked）
- [ ] 1.2 参数校验单测（wait+Async、wait+no-wait、reply-chars 越界）
- [ ] 1.3 MCP schema 快照（agent_send 新字段、session_wait）
- [ ] 1.4 CLI flag 绑定单测
- [ ] 1.5 红证落盘 `loop/red/F-1121-agent-roundtrip.txt`；`queue gate --gate g2 --red-proof ...`

## 2. 判定器与采集

- [ ] 2.1 `pkg/wshrpc/wshserver/replysignal.go`：`replyBaseline`、`replyComplete`、采集器（agentStatusSeq 复用 / filestat / turnCount）
- [ ] 2.2 turn 计数来源确认（manager Summary 现成字段优先，避免二次解析）

## 3. 发送侧扩展

- [ ] 3.1 `wshrpctypes.go`：AgentSendRequest 增 `WaitReply *bool / ReplyWaitMs / ReplyChars / ReplyPollMs / NoWait`；Result 增 `Replied / Turn / ReplyText / Truncated / TotalChars / ReplyCursor / WaitedMs`
- [ ] 3.2 `normalizeSendParams`：互斥校验（Async / NoWait / WaitReply）
- [ ] 3.3 `agentsend.go`：基线采集 → 注入 → 等待窗口 → 回复读取 → Result 填充
- [ ] 3.4 回复读取复用 `session turn` 管线（chars 预算夹紧）

## 4. session wait

- [ ] 4.1 `wshrpctypes.go` SessionWaitRequest/Result
- [ ] 4.2 `session_commands.go` SessionWaitCommand（live record 过滤 + 轮询 + 超时）
- [ ] 4.3 wshclient 注册

## 5. CLI / MCP

- [ ] 5.1 `wshcmd-agent.go`：send 增 flags（--wait-reply/--no-wait/--reply-wait-ms/--reply-chars/--reply-poll-ms）
- [ ] 5.2 `wshcmd-session.go`：`session wait` 子命令（--until/--timeout-ms，超时退出码 3）
- [ ] 5.3 `tools.go`：agent_send 扩展 + `snorkeling_session_wait`（observe）
- [ ] 5.4 schema/scope 快照通过

## 6. 构建

- [ ] 6.1 gotypes 重生成
- [ ] 6.2 `go build ./...`；`go test ./pkg/wshrpc/wshserver ./pkg/agentcontrol ./pkg/agentmcp ./cmd/wsh/cmd -count=1`

## 7. 真机验证（G7 证据）

- [ ] 7.1 新 area `scripts/verify/agent-roundtrip`（复用 lib，剧本覆盖 AC4-AC7）
- [ ] 7.2 `node scripts/verify/index.mjs --area agent-roundtrip` → exit 0
- [ ] 7.3 手动补：pi 块 `ROUNDTRIP_OK` 全链路（send → 等 → 回复摘要）、超时用例、no-wait 游标、session wait 命中与 E_NOT_FOUND
- [ ] 7.4 `verify-ledger.md` 入账 + playbook 回写

## 8. G5 / 收尾

- [ ] 8.1 `go vet`；deps 无新增；`queue gate --gate g5`
- [ ] 8.2 `detect_changes` 确认 whitelist
- [ ] 8.3 spec 回写（「回合完成三信号」契约进 `.trellis/spec/`）
- [ ] 8.4 commit + Trellis archive + loop note 等 G7

## 回滚点

- 3.3 等待窗口导致 RPC 超时（wshclient 默认 timeout 8s）→ CLI/MCP 必须显式放大 RPC timeout（会话命令已有 --timeout；send 需新增默认 120s 的 RPC 超时），否则一律 `E_TIMEOUT` 假失败。此处是已知最大坑，实现时优先验证。
