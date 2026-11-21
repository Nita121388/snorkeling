> **Confirmed: 2026-11-21 @nita**

# Agent Resume：按会话恢复 agent 块 + session mark 写入口

## Goal

外部 agent 通过 `wsh agent resume`（CLI）与 `snorkeling_agent_resume`（MCP）**按会话恢复 agent 块**，可选恢复后立刻补发一句话（`--send`）；`wsh session mark` + MCP 补齐 marked 写入口。与既有 `agent launch` / `agent send` / 会话读路径组成完整闭环：**找到会话 → 续上 → 喂信息 → 收结果**（收结果由 11-21-agent-roundtrip 承担，不在本包）。

## 现状（关键事实）

- GUI 恢复链路（前端独有）：`RestoreContext` RPC（`pkg/service/aisessionsservice/aisessionsservice.go:1360`：summary + claude vendor 解析）→ 前端 `restoreMetaForSession`（`frontend/app/view/aisessions/utils.ts:737`）拼 meta → `createBlock`。
- meta 契约（GUI 版）：`view=term` / `controller=cmd` / `cmd=<agent 可执行名>` / `cmd:shell=false` / `cmd:runonstart=true` / `cmd:jwt=true` / `agent:autoresume=true` / `agent:provider` / `agent:sessionid`；`projectpath → cmd:cwd`；claude vendor → `cmd:env CLAUDE_CONFIG_DIR` + `agent:claudevendorid/vendorname`。
- 后端 `shellcontroller`（`pkg/blockcontroller/shellcontroller.go:1042` 起）已消费 `agent:autoresume + agent:provider + agent:sessionid` meta，转成真实 resume 参数（codex `resume <id>`、claude `--resume <id>`、opencode `--session <id>`、pi 由后端 mint session id）。**恢复的执行机器件全在后端，只缺 CLI/MCP 入口。**
- `wsh agent launch`（`pkg/wshrpc/wshserver/agentlaunch.go`）已有：catalog 校验、`resolveTabTarget`、`splitTargetAction`、`CreateBlockCommand`、`waitForLayoutApplied`、remote 拒绝（`validateLaunchConnection`）。
- `wsh agent send`（`pkg/wshrpc/wshserver/agentsend.go`）已有：quiet 就绪判定、bracketed paste 注入、提交确认、async dispatch。
- `AISessionsService.Mark`（`aisessionsservice.go:1546`）→ `Manager.Mark`（`pkg/aisessions/manager.go:876`）：GUI 在用，无 CLI/MCP 入口。
- `agentcontrol.ResolveSessionIdentifier`（`pkg/agentcontrol/card.go:26`）：精确 key/id + `this`。

## Requirements

### R1 `wsh agent resume <sessionKey|sessionId|this>`

- 解析：`ResolveSessionIdentifier`；未命中 → `E_NOT_FOUND`（沿用精确解析，不做前缀匹配）。
- 恢复上下文：summary + claude vendor 解析，语义与 `RestoreContext` 一致（claude vendor 不可得 → `E_VENDOR_UNAVAILABLE`，与 GUI 的 `VendorConfigurationUnavailableError` 同口径）。
- meta：后端 `agentcontrol.BuildResumeBlockMeta`，与前端 `restoreMetaForSession` **parity**（golden 测试锁字段）。未知 source（如 gemini）→ `E_USAGE` 拒绝（见 design D4，不复制 GUI 的 fallback-codex）。
- 建块：复用 agentlaunch 路径（`resolveTabTarget` / `CreateBlockCommand` / `waitForLayoutApplied`）。参数：`--tab active|new|<tabid>`、`--workspace`（仅 `--tab new`）、`--cwd`（覆盖 projectpath）、`--no-focus`、`--wait`、`--wait-ms`、`--json`。
- remote 连接拒绝（同 11-09 `validateLaunchConnection` 语义）。
- `--json` 返回：`ok` / `blockid` / `sessionid` / `source` / `projectpath` / `syncstate` / `warnings`。

### R2 `agent resume --send <text>`

- 建块 + layout applied 后走 `AgentSendCommand` 同款管线（quiet 等待 + bracketed paste + 提交确认）。`--no-submit` / `--quiet-ms` / `--wait-ms` / `--submit-delay-ms` 全对齐 `agent send`。
- 原子语义：建块成功但发送超时**不回滚块**（同 11-18 R1），错误码区分 `E_AGENT_NOT_READY`。
- 文本清洗与 64KB 上限复用 `SanitizeSendText` / `resolveSendText`。

### R3 MCP `snorkeling_agent_resume`

- 参数与 R1/R2 一一对应；scope=`launch`（能建块就能恢复）。
- schema 快照测试（tools_test）。

### R4 `wsh session mark <identifier> [--unmark]` + MCP `snorkeling_session_mark`

- 薄封装 `Manager.Mark`（与 GUI 同一函数），返回更新后的 summary 关键字段。
- marked 是视图状态（星标），不是卡片内容：**不走 agentdata patch**，无 dry-run/hash 门（理由与边界见 design D5）。scope=`data`。

## Non-goals

- GUI 恢复链路改动（前端零改动；后端 meta 保持 parity 即可）。
- remote 恢复、headless / ACP 通道（P2 候选，另立任务）。
- 等回合完成收回复（11-21-agent-roundtrip）。
- gemini 恢复（无已知 resume cmd；见 design D4）。

## Acceptance Criteria（机器可判定）

1. `go build ./...` → exit 0。
2. `go test ./pkg/agentcontrol ./pkg/wshrpc/wshserver ./pkg/agentmcp ./cmd/wsh/cmd` → 0 fail。
3. parity 单测：五组 fixture（claude+vendor、claude 无 vendor、codex、opencode、pi）的 `BuildResumeBlockMeta` 输出与前端契约逐字段一致（golden JSON，前后端各锁一份同源 fixture）。
4. 真机（dev 实例）：pi 会话 `agent resume <key> --json` → `ok=true`，块 meta `agent:sessionid` 命中，TUI 恢复历史。
5. 真机：`agent resume <pi-key> --send 'reply with exactly: RESUME_OK' --json` → `ok/injected/submitted=true`，TUI 输出 `RESUME_OK`。
6. 真机：codex 会话恢复一次；claude / opencode 未安装则台账记 `skipped`，不静默省略。
7. 真机：`wsh session mark <id>` 后 `wsh session list --marked true` 含该行，`--unmark` 复原；MCP `snorkeling_session_mark` 同验。
8. 错误路径：不存在 → `E_NOT_FOUND`；remote → `E_UNSUPPORTED`（沿用 11-09 `validateLaunchConnection` 的码）；gemini → `E_USAGE`（单测或真机）。
9. MCP：`agent_resume` / `session_mark` schema 快照 + scope 测试（`data` scope 拒绝 resume、放行 mark）。
10. `docs/project/verify-ledger.md` 入账一行结论；明细在 `verify-runs/`（gitignore）；跑完自动关实例（不留 `--keep-open`）。

## Notes

## 实现期偏差（2026-11-21，子代理报告后回写）

- `--wait` 是 layout 等待开关，DTO 补了 `Wait bool`（design §2 漏字段，R1 明确要求）。
- `--wait-ms`（layout）与 send 侧 readiness 撞名：CLI 用 `--send-wait-ms` / `--no-send-wait` 区分。
- `--tab new` 必须显式带 `--workspace`（与 launch 的“落到当前 workspace”不同，已按红证固化）。
- 白名单追加：`pkg/agentscope/scope.go`（agentresume→launch、sessionmark→data）、`cmd/wsh/cmd/wshcmd-mcp.go`（Backend 接口实现）、`frontend/app/store/wshclientapi.ts`（generate 产物）。

## Notes

- 对应 loop 工作项：`F-1121-agent-resume`（arch 类，G1/G2/G5/G6/G7）。
- 四家同类项目对账（Orca/T3/Paseo/Herdr 恢复与编排模型）见 `docs/answers/multi-agent-orchestration-20261121.html`——本包即其中「会话层上下文交接」的 Snorkeling 实现。
