# Implement: Agent Block 发送文本

前置：`11-09-agent-block-create` 已实现（`AgentLaunchCommand` 可用）。

## 顺序清单

1. **纯函数包内落点**：`pkg/wshrpc/wshserver/agentlaunch.go` 同文件追加（同族聚合，不建新包）：
   - `SanitizeSendText(text string) (string, error)` — 剥离 C0/ESC（保留 `\n` `\t`）、64KB 上限。
   - `buildInjectBytes(text string) []byte` — `\x1b[200~ text \x1b[201~`。
   - `validateSendParams(req) error` — WaitMs/QuietMs/SubmitDelayMs 范围、Text/Text64 二选一。
   - 单测进 `agentlaunch_test.go`（或新 `agentsend_test.go`）。

2. **DTO**：`wshrpctypes.go` 加 `AgentSendRequest` / `AgentSendResult`；`AgentLaunchRequest.Send` / `AgentLaunchResult.Send` 追加字段；`WshServerCommand` 加 `AgentSendCommand`。

3. **Handler** `pkg/wshrpc/wshserver/agentsend.go`：
   - `resolveSendTargetBlock`：`this` 复用 `block read` 的 this 解析路径（抽 `resolveThisBlockId(ctx)`）。
   - `waitForTermQuiet(ctx, blockId, waitMs, quietMs) (waitedMs int, err error)`：`blockcontroller.GetBlockControllerRuntimeStatus` + `filestore.WFS.Stat(term file)` 100ms 采样。
   - `AgentSendCommand`：清洗 → 就绪 → 注入 → （sleep SubmitDelayMs）→ `\r`。
   - `AgentLaunchCommand` 尾部：`data.Send != nil` → 串接 `AgentSendCommand`，结果挂 `rtn.Send`。

4. **CLI** `cmd/wsh/cmd/wshcmd-agent-send.go`：`agentCmd.AddCommand(agentSendCmd)`；`--block`（默认 `this`）、`--text`、`--stdin`、`--no-submit`、`--no-wait`、`--wait-ms`、`--quiet-ms`、`--submit-delay-ms`、`--json`。
   - `wshcmd-agent-launch.go` 加 `--send <text>` → `req.Send = &AgentSendRequest{...}`。

5. **生成绑定**：`go run cmd/generatets/main-generatets.go && go run cmd/generatego/main-generatego.go`。

6. **scope**：`agentscope` `commandScopes["agentsend"] = Launch`；`scope_test.go` 断言。

7. **MCP**：`snorkeling_agent_send`（Backend 加 `AgentSend`，`rpcBackend` 实现用 Text64）；`snorkeling_agent_create` 加 `message` 参数。

8. **发现面**：`agentcap.GuideText` 增补；`docs/project/agent-control-surface.md` 增补命令段。

9. **验证**：
   - `go build ./...` && `go test ./pkg/wshrpc/wshserver ./pkg/agentscope ./pkg/agentmcp ./cmd/wsh/...`
   - 真机 A4（term 块探针）/ A5（launch --send）按 `prd.md`；台账 `docs/project/verify-ledger.md` 记录。

## 回滚点

单 commit（全部 additive）；revert 即回滚，无数据迁移。

## 风险与对策

| 风险 | 对策 |
|---|---|
| controller 未运行（块未挂载）→ 注入丢字节 | 先查 runtime status；not running → `E_BLOCK_NOT_READY`，不静默丢 |
| 就绪判定误判（banner 后静默 ≠ 输入框可用） | `QuietMs` 可调 + `E_AGENT_NOT_READY` 可重试；真机判据覆盖 pi/claude 两种 TUI |
| 双通道文本（Text/Text64）歧义 | `Text64` 优先，写死在 handler 与文档 |
| 与前端 pending-input 双注入 | 后端从不写 pending store；前端不知后端注入。同一文本理论上可能被两条链各自投递一次，但前提是调用方同时用了两个入口 —— 文档写明禁止 |
