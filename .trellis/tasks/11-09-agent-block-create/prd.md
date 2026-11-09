# Agent Block 程序化创建：wsh agent launch + MCP 工具

## Goal

让外部 agent / 脚本 / MCP 客户端能**按 profile + model** 在**指定 tab** 创建 claude / codex / pi / opencode 的 TUI agent block，产物与 GUI（WidgetsBar → New Agent）建出来的块在 meta 层一致，从而可以用程序化方式拉起任意一种 CLI agent，并支持 pi 这类多供应商 agent 的模型选择。

## 现状（实测，2026-11-09）

| 现有路径 | 实测行为 | 缺口 |
|---|---|---|
| `wsh block open --view agent` | 后端 `BlockOpenCommand` 对 `cmd:*` / `agent:*` 直接返回 `E_FORBIDDEN` | `view=agent` 是 **GUI 聊天块**（`createGuiChatBlockDef`: `view:"agent"`, `aisessions:newchat`），不是 CLI agent 块 |
| `wsh launch defwidget@agent` | 确实建出块（实测 `7aee4195`） | 默认 widget 在 `pkg/wconfig/defaultconfig/widgets.json` 硬编码 `{"cmd":"codex"}` → **永远裸 codex**，无 profile/model/vendor |
| `wsh createblock`（hidden） | 需要调用方自己拼 `cmd:args` / `cmd:env` | 等于开放任意命令注入，不可接受 |
| WidgetsBar → New Agent（GUI） | 完整可用（profile/vendor/model 都能选） | 只能人手点，外部 agent 调不到 |

前端已有完整构造逻辑 `frontend/app/workspace/agent-launch.ts:createAgentBlockDef()`（约 963–1096 行），产物 meta 见 `design.md` 的 meta 契约表。后端已有 agent 目录 `pkg/agentcatalog`（`wsh agent list --json` 实测返回 claude / codex / pi / opencode / gemini 及各自模型，pi 为 20 个模型跨 6 个 provider）。

**结论：缺的不是"建块逻辑"，而是"受目录约束的程序化入口"。**

## Requirements

- **R1 新命令**：`wsh agent launch`，与现有 `wsh agent list` 同级，走 wsh RPC。
- **R2 参数**：`--profile <name>`（必填）、`--model <id|provider/id>`、`--tab active|new|<tabid>`（默认 active）、`--workspace`（仅 `--tab new`）、`--cwd`、`--split right|down|left|up`、`--magnified`、`--no-focus`、`--wait`、`--wait-ms`、`--json`。
- **R3 模型选择**：
  - 不传 `--model` → 用 catalog 的 `defaultModel`（当前 `pi → deepseek-v4.1-flash`）；catalog 无 default（如 opencode / gemini）→ 不追加 `--model`。
  - 传裸 `id` → 必须命中该 profile 的 `models[].id`。
  - 传 `provider/id` → 必须命中 `models[]` 中 `provider` + `id` 组合。此形态直接透传给 CLI（pi 原生支持 `provider/id`）。
  - 校验失败 → `E_MODEL_NOT_IN_CATALOG`，附合法候选（有上限），且**不得创建任何块**。
- **R4 meta 契约**：产物必须是 term block（`view=term`, `controller=cmd`），并写入 `cmd` / `cmd:args` / `agent:provider` / `agent:requestedmodel` / `agent:autoresume` / `agent:isolationmode`。完整字段表见 `design.md`。
- **R5 MCP 工具**：新增 `snorkeling_agent_create`，参数与 R2 对齐，走同一后端实现（不得出现第二份建块逻辑）。
- **R6 scope**：新增 `launch` scope，`agentlaunch` 命令登记到 `pkg/agentscope`。`launch` 强于 `data`、弱于 `destructive`。
- **R7 `defwidget@agent` 修正**：`wsh launch defwidget@agent` 不再产出裸 codex，改为按 catalog 默认 profile 走新的 launch 路径（不硬编码任何 agent 名）。
- **R8 拒绝清单**（安全）：
  - 不接受调用方提供的 `cmd` / `cmd:env` / 任意 meta 注入。
  - 不放开 `BlockOpenCommand` 现有的 `cmd:*` / `agent:*` 禁止规则。
  - 未知 profile 必须报错——**不得**沿用 `agentcatalog.Resolve()` 的"未知名字兜底成 `--model`"行为。

## Non-goals（本轮不做）

- **GUI 聊天块**（`view=agent` + `aisessions:newchat`）的程序化创建 → P2 另开。
- **vendor / 供应商隔离**（`--vendor`、`CLAUDE_CONFIG_DIR` / `CODEX_HOME` / `OPENCODE_CONFIG_DIR` / `PI_CODING_AGENT_SESSION_DIR`）→ P1 另开。
- 前端任何改动（WidgetsBar 现有流程保持原样）。
- 自动 resume / 会话续接策略调整。

## Constraints

- 只走 `pkg/agentcatalog` 作为 agent 与模型的唯一事实来源（与 `wsh agent list`、定时任务编辑器一致）。
- 建块必须复用 `CreateBlockCommand`，不新增第二条建块路径；`--wait` 语义沿用 `BlockOpenCommand` 的 `layout-queued` / `layout-applied` 三态。
- 不改动 `pkg/wconfig/defaultconfig/widgets.json` 里的 widget 元数据（icon / label / blockdef 仍作为 UI 元信息保留）。
- 所有新增导出函数需有单测覆盖边界。

## Acceptance Criteria（机器可判定）

1. `go build ./...` → exit 0。
2. `go test ./pkg/agentcatalog ./pkg/agentscope ./pkg/wshrpc/wshserver ./pkg/agentmcp ./pkg/wshutil ./cmd/wsh/...` → 0 fail。
3. `wsh agent launch --profile claude --tab active --wait --json` → `ok=true`，`syncstate="layout-applied"`，`blockid` 非空，`profile="claude"`。
4. 同次结果的 `meta` 字段满足：`view=term`、`controller=cmd`、`cmd` 以 `claude` 结尾、`agent:provider="claude"`、`agent:autoresume=true`。
5. `wsh agent launch --profile pi --model nonexistent-model` → 退出码非 0，stderr 含 `E_MODEL_NOT_IN_CATALOG`，且 `wsh blocks list | wc -l` 前后相等（未建块）。
6. `wsh agent launch --profile pi --model deepseek/deepseek-v4-flash --json` → `args == ["--model","deepseek/deepseek-v4-flash"]`，`agent:requestedmodel="deepseek/deepseek-v4-flash"`。
7. `wsh agent launch --profile opencode --json` → `args` 不含 `--model`（opencode 无模型列表）。
8. `wsh agent launch --profile no-such-agent` → 退出码非 0，stderr 含 `E_PROFILE_UNKNOWN`。
9. `pkg/agentscope` 单测覆盖：granted=`[data]` 不满足 `launch`；granted=`[launch]` 满足 `data`；granted=`[destructive]` 满足 `launch`；`RequiredForCommand("agentlaunch") == launch`。
10. `wsh launch defwidget@agent --json` → 产物 `profile` 等于 catalog 默认 profile（当前 `pi`），块 `cmd` 不再是 `codex`。
11. `node scripts/verify/index.mjs --area agent-launch` → exit 0，且 `docs/project/verify-ledger.md` 新增一行结论。

## Notes

- 术语澄清：本任务的 "agent block" 一律指 **term block + agent:\* meta**（TUI CLI agent）。`view=agent` 是 GUI 聊天块，不在此范围。
- 用户 2026-11-09 明确：**优先保证 profile + model 可用**；vendor 与 GUI 模式可以后续做。
- 建块会产生真实进程，验证脚本必须负责关闭（端口/PID 或 block 关闭），不得留下后台 agent 进程。
