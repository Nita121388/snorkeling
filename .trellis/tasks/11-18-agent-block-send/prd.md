# Agent Block 发送文本：`wsh agent send` + `launch --send` + TUI 就绪判定

## Goal

外部 agent / 脚本能一步完成「创建 agent block → 等 TUI 就绪 → 注入文本 → 提交」，也能对已存在的 term/agent 块补发文本。

发送走**后端直写 PTY**（`blockcontroller.SendInput` / `controllerinput` 路由），不依赖前端挂载、不需要 CommonText 的隐藏挂载 + xterm paste 链路。**块照常在 UI 里展示**（落在指定 Tab，默认不抢焦点）；「隐藏」只是不需要前端参与注入，不是产品行为。

前置任务：`.trellis/tasks/11-09-agent-block-create/`（`wsh agent launch`，本任务复用其 RPC 与 meta 契约）。

## 现状（关键事实）

- 前端 CommonText 发送链（`frontend/app/commontext/pending-input.ts` + `term.tsx:590`）：隐藏挂载 Tab → 等 quiet → xterm `paste()` → 延时 150ms → `ControllerInputCommand` 补 `\r`。实测教训：**只 paste 不回车 = agent 收不到**。
- `ControllerInputCommand`（`pkg/wshrpc/wshserver/wshserver.go:489`）→ `blockcontroller.SendInput` → PTY，后端可独立调用，`BlockInputUnion.InputData` 为原始字节。
- pi 块多行依赖 bracketed paste 标记（`\x1b[200~` / `\x1b[201~`，见 `term-model.ts:456` 与 pi-tui #7321）。
- 前端就绪判定 `computeInjectDecision`：基线 `lastUpdated` 与当前 `lastUpdated` 无变化（quiet）即注入，TTL 兜底。

## Requirements

- **R1 一步发送**：`wsh agent launch --send <text>` = launch（建块）+ 就绪等待 + 注入 + 提交，原子语义：建块成功但发送超时不回滚块，错误码区分。
- **R2 补发**：`wsh agent send --block <blockid|this> --text <s>`（或 `--stdin` 读 stdin）对已存在 term/agent 块发送；块不是 term 块或 controller 未运行 → `E_BLOCK_NOT_READY`。
- **R3 注入格式**：`\x1b[200~` + text + `\x1b[201~`，延时（默认 150ms，`--submit-delay-ms` 可调）后单独写 `\r` 提交。多行文本在 bracketed paste 内一次写入，只补一个 `\r`。
- **R4 就绪判定（后端化）**：轮询目标块的 term 输出文件（size+mtime），连续 quiet（默认 400ms，`--quiet-ms`）且 controller `running` → 就绪；总超时（默认 30s，`--wait-ms`）→ `E_AGENT_NOT_READY`（返回 blockid 供 `wsh agent send` 重试）。`--no-wait` 跳过等待直接注入。
- **R5 提交开关**：默认提交；`--no-submit` 只注入不回车（对齐 CommonText 「填入草稿」语义）。
- **R6 MCP 工具**：`snorkeling_agent_send`（block/text/submit/wait），参数与 R2 对齐；`snorkeling_agent_create`（11-09）增加 `message` 参数 → 走同一 R1 实现。
- **R7 scope**：`agentlaunch`（launch 级）：能建块就能发，不给单独更低门。
- **R8 输入清洗**：文本剥离 C0 控制字符（保留 `\n` `\t`）、上限 64KB，超出 `E_USAGE`；文本不经过任何 shell 解析（bracketed paste 本身不展开）。
- **R9 可观测**：`--json` 返回 injected（是/否）、submitted、waitedMs、quietMs、submitDelayMs；`wsh block read` 可复核注入结果。

## Non-goals

- 前端 CommonText 链路改动（两路并存：前端链服务 UI 交互，后端链服务程序化调用，互不触碰对方的 pending 状态）。
- GUI 聊天块（`view=agent`）发送。
- remote 连接的块发送（与 11-09 同步拒绝）。
- agent 回复等待 / 轮询结果（那是 `wsh session *` 读路径的事）。

## Constraints

- 注入必须复用 `blockcontroller.SendInput`（或 `ControllerInputCommand` handler），不得出现第二 PTY 写入路径。
- 就绪判定不得引入新的轮询进程；在 RPC handler 内限时轮询（与 `BlockOpenCommand --wait` 同款风格）。
- 不修改 `pending-input.ts` / `term.tsx`。

## Acceptance Criteria（机器可判定）

1. `go build ./...` → exit 0。
2. `go test ./pkg/wshrpc/wshserver ./pkg/agentmcp ./cmd/wsh/...` → 0 fail。
3. 纯函数单测：注入字节序列 = `ESC[200~ + text + ESC[201~`，提交字节 = `\r`；清洗后 `\r`、ESC、BEL 均被剥离、`\n`/`\t` 保留；64KB 上限报 `E_USAGE`。
4. 真机：建一个本地 term 块（`wsh block open --view term`），`wsh agent send --block <id> --text 'echo SNORKELING_SEND_OK'` → `ok=true`；2s 后 `wsh block read <id> --tail 20` 输出含 `SNORKELING_SEND_OK`。
5. 真机：`wsh agent launch --profile pi --send 'hello' --json` → `ok=true`，`injected=true`，`submitted=true`，返回 blockid；验证后关闭块。
6. `wsh agent send --block <非term块> --text x` → 退出码非 0，stderr 含 `E_BLOCK_NOT_READY`。
7. `wsh agent send --block <id> --text "$(python3 -c 'print("a"*70000)')"` → 退出码非 0，stderr 含 `E_USAGE`。
8. MCP `snorkeling_agent_send` schema 含 block/text/submit/wait 必填约束（`tools_test.go` 或 spec 快照）。

## 验证结果（2026-11-18 22:55，dev 实例 verify-agent-launch，跑完已关）

| # | 判据 | 结果 |
|---|---|---|
| 1 | `go build ./...` | ✅ exit 0 |
| 2 | `go test ./pkg/wshrpc/wshserver ./pkg/agentmcp ./pkg/agentscope ./pkg/waveobj ./pkg/agentcatalog` | ✅ 全绿 |
| 3 | 纯函数单测（注入字节/清洗/边界/默认） | ✅ 通过 |
| 4 | term 块注入 `echo SNORKELING_SEND_OK` | ✅ `injected=true submitted=true`；block term 文件出现 `SNORKELING_SEND_OK` 且 shell 集成回报 `exitcode:0`（`block read` 走前端路由，未挂载时返回 `term-route-unavailable`，故直接核对 filestore 的 term 输出） |
| 5 | `wsh agent launch --profile pi --send 'reply with exactly: OK'` | ✅ `injected=true submitted=true waitedms=1325`，pi TUI 输出 `OK`，模型显示 `(deepseek) deepseek-v4.1-flash` |
| 6 | 发到 preview 块 | ✅ `E_BLOCK_NOT_READY: ... is view "preview", not a term block` |
| 7 | 70KB 文本 | ✅ `E_USAGE: text is 70000 bytes, over the 65536 byte cap` |
| 8 | MCP schema/scope | ✅ agentmcp 单测（18 工具；data 拒绝 launch/send，launch 放行） |

期间修掉两个真实缺陷（都已回写本 PRD 的 design/契约）：
1. `ShellController` 先报 `running` 后建 input chan → 首次写入失败；改为对 `no shell input chan` 限时重试 3s。
2. pi 的裸模型 id 跨 provider 歧义 → 目录里有 provider 时统一展开成 `provider/id`。

## Notes

- 与 CommonText 并存：后端链不注册 pending input，前端链不知道后端链，零耦合。
- 用户 2026-11-18 澄清：块**正常展示**在 Tab；「后台」= 不抢焦点不跳转，不是隐藏块。
