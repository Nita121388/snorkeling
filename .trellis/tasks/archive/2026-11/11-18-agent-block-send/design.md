# Design: Agent Block 发送文本（后端直写 PTY）

## 1. 总体

```
wsh agent launch --send        wsh agent send --block        MCP snorkeling_agent_send
        └──────────────┬──────────────┴──────────────────────────┘
                       ▼
        WshServer.AgentSendCommand（新 RPC handler）
                       ├── resolveTargetBlock（blockid | this）
                       ├── waitForTermQuiet（就绪判定，限时轮询）
                       ├── injectBracketedPaste（\x1b[200~ text \x1b[201~）
                       └── submitEnter（延时 \r）
                                   ▼
                    blockcontroller.SendInput（唯一 PTY 写入口）
```

- `launch --send` = `AgentLaunchCommand`（11-09）+ `AgentSendCommand`（本任务）串行调用，两个 handler 都保持单一职责；失败时错误码区分建块段与发送段。
- 前端 CommonText 链路零改动、零耦合：后端不碰 `pending input` store。

## 2. RPC 契约

```go
type AgentSendRequest struct {
    BlockId       string `json:"blockid,omitempty"` // blockid 或 "this"
    Text          string `json:"text,omitempty"`    // 与 Text64 二选一
    Text64        string `json:"text64,omitempty"`   // base64（MCP/大文本/控制字符安全通道）
    Submit        bool   `json:"submit,omitempty"`   // 默认 true
    Wait          bool   `json:"wait,omitempty"`    // 就绪等待，默认 true（--no-wait 跳过）
    WaitMs        int    `json:"waitms,omitempty"`   // 就绪总超时，默认 30000
    QuietMs       int    `json:"quietms,omitempty"`  // 输出静默阈值，默认 400
    SubmitDelayMs int    `json:"submitdelayms,omitempty"` // paste→回车延时，默认 150
}

type AgentSendResult struct {
    Version        int    `json:"version"`
    Ok             bool   `json:"ok"`
    BlockId        string `json:"blockid"`
    View           string `json:"view"`
    Injected       bool   `json:"injected"`
    Submitted      bool   `json:"submitted"`
    WaitedMs       int    `json:"waitedms,omitempty"`
    QuietMs        int    `json:"quietms"`
    SubmitDelayMs  int    `json:"submitdelayms"`
    Warnings       []string `json:"warnings,omitempty"`
}
```

`AgentLaunchRequest` 追加 `Send *AgentSendRequest `json:"send,omitempty"``（launch 收到后串接发送；`AgentLaunchResult` 追加 `Send *AgentSendResult`）。`--send` CLI 参数在 CLI 层转成 `Send` 子结构，不污染 launch 的建块字段。

## 3. 注入与提交（核心不变量）

- **唯一写入口**：`blockcontroller.SendInput(blockId, &BlockInputUnion{InputData: bytes})`。不经前端、不经 xterm。
- **bracketed paste**：`"\x1b[200~" + cleanText + "\x1b[201~"` 一次写入；多行安全（pi-tui #7321 语义），只补一个 `\r`。
- **提交**：写 paste 后 sleep `SubmitDelayMs`（默认 150ms，对齐前端 `SubmitAfterPasteDelayMs` 实测值），再单独写 `"\r"`。sleep 期间输出继续增长不算失败。
- **清洗**（纯函数 `SanitizeSendText`）：剥离除 `\n`、`\t` 外的 C0 控制字符与 `ESC`；>64KB 报 `E_USAGE`。
- 输入通道：`Text` 原文（wsh CLI 用户直传）或 `Text64`（base64）。两者都空 → `E_USAGE`；都有 → `Text64` 优先。

## 4. 就绪判定 `waitForTermQuiet`（纯轮询，无新进程）

状态机（对齐前端 `computeInjectDecision` 的 quiet 语义，但信号源换成块文件）：

1. `blockcontroller.GetControllerRuntimeStatus(blockId)`（既有导出函数，`ui state` 已在用）：`ShellProcStatus != running` → `E_BLOCK_NOT_READY`。
2. 块 meta `view != "term"` → `E_BLOCK_NOT_READY`（GUI 聊天块等非 term 块不在范围）。
3. 轮询 `filestore.WFS.Stat(ctx, blockId, wavebase.BlockFile_Term)`：以第一次成功的 `(Size, ModTs)` 为基线；此后每 100ms 采样，`Size/ModTs` 连续 `QuietMs` 无变化 → ready。
4. 首个样本即 quiet 也成立（例如 launch 刚建块、TUI 已打完 banner）：条件是「基线存在且已静默 QuietMs」。
5. 超时 → `E_AGENT_NOT_READY`，`BlockId` 已在建块段返回，调用方可 `wsh agent send` 重试。
6. `Wait=false`（`--no-wait`）：跳过 3–5，直接注入（调用方自担风险），结果带 `warning: "wait-skipped"`。

轮询预算：`WaitMs` 上限 120000；`QuietMs` 范围 [100, 5000]；`SubmitDelayMs` 范围 [0, 2000]，越界 `E_USAGE`。

## 5. 目标解析

- `--block <id>`：`wstore.DBMustGet[*waveobj.Block]` 校验存在。
- `this`：复用 `pkg/agentcontrol` 的 `this` 解析（block meta `agent:sessionid` → `agentstatus`）？不 —— `this` 在此处语义是「调用方所在的块」，走 `wsh rpc` 的 `RpcContext`（外部进程经 WAVETERM_BLOCKID 环境变量），与 `block read this` 同一实现：抽出 `resolveThisBlockId(ctx)`（目前 block read 用的是它自己的解析，直接复用其代码路径）。
- `blockid` 与 `this` 都空 → `E_USAGE`。

## 6. scope / MCP / 发现

- `agentscope.commandScopes["agentsend"] = Launch`（launch 级，7 发送不降到 data：能建块就能发）。
- MCP：`snorkeling_agent_send`（schema：blockid/text64/submit/wait/waitms），`snorkeling_agent_create`（11-09）追加 `message` 参数 → CLI/MCP 都映射到 `AgentSendRequest`。
- `agentcap.GuideText` 补一节「Sending text to an agent block」。

## 7. 错误码汇总

| 码 | 场景 |
|---|---|
| `E_USAGE` | text 双空双给 / 超长 / 参数越界 / blockid 缺失 |
| `E_NOT_FOUND` | blockid 不存在 |
| `E_BLOCK_NOT_READY` | 非 term 块 / controller 未运行 / ShellProcStatus 异常 |
| `E_AGENT_NOT_READY` | 就绪等待超时（块仍在，可重试） |
| `E_UNSUPPORTED` | 远端 connection 的块 |

## 8. 兼容与回滚

- 全部 additive：新 RPC + CLI flag + MCP 工具 + GuideText 段落。无 DB 迁移、无前端改动。
- launch 侧改动（`Send` 子结构）向后兼容：旧调用方不传 `send` 行为不变。
- 回滚：单 commit revert 即可。

## 9. 测试策略

- 纯函数单测：`SanitizeSendText`（控制字符/换行/长度）、注入字节构造、参数边界。
- Handler 单测：非 term 块 → `E_BLOCK_NOT_READY`；unknown block → `E_NOT_FOUND`（mock wstore 用既有测试基建）。
- 真机判据：见 `prd.md` A4/A5（`echo SNORKELING_SEND_OK` 探针），验证台沿用 `scripts/verify/commontext-send-agent-block` 的启动/关闭脚手架另建 `agent-send` area。
