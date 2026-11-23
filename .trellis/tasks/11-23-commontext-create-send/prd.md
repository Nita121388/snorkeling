# PRD：CommonText 新建 agent 后文本发不出去

> 父：`11-23-session-surface-fixes-1123`（优先级序 1，S）

## Goal

CommonText「新建 agent 并发送」与「发送到已有 agent」走**同一条有提交确认的后端链路**，
文本永远不再静默睡在 agent 的输入框里。

## 症状与根因（已核实，2026-11-23）

用户在 CommonText 编辑并「新建 agent」发送：文本粘进了新块的输入框，但回车没生效，
消息没发出去，且 UI 报「已发送」。

两条路径的现状：

| 路径 | 实现 | 提交确认 |
|---|---|---|
| existing（发到聚焦 agent 块） | `commontext-send-button.tsx:251` `AgentSendCommand(async:true)` → 后端 `deliverAgentSend`：就绪门 + paste + 回车 + `confirmSubmit`（补回车 ≤180s） | ✅ |
| **create（新建 agent，本 bug）** | `commontext-send-button.tsx:323` `registerPendingInput(blockId, text)` → `term.tsx:612-630` 前端 `terminal.paste(text)` + `setTimeout(submitTermInput, SubmitAfterPasteDelayMs)` 一次性回车 | ❌ 无确认、无补发 |

pi 冷启动会跑 `npm view` 查扩展更新（实测 40s+），启动期吞回车 → 文本留在输入框。
旁证：当日 `Data/waveapp.log` `[agentsend]`/`[agentdispatch]` 0 条（create 路径不经过后端）。

## Requirements

- R1 create 路径改走 `AgentSendCommand`：`submit:true, async:true, wait:true, waitms:120000`
  （pi 冷启动 40s+，`waitms` 默认 30s 不够），建块成功后 fire-and-forget 发起。
- R2 本地块**不再** `registerPendingInput` / `mountPendingInputTab`（后端写 PTY 不依赖前端 xterm
  挂载，隐藏预挂载整条链对此场景退役）。`pending-input` 模块本身保留（远端 create 场景未来仍需要，
  本包不删模块、不动 term.tsx 消费端）。
- R3 失败可观测：`submitconfirmed=false` 或抛错 → `onStatus(err)` + console.warn（与 existing 路径同款），
  不回滚已建的块。
- R4 existing 路径、远端 fallback 路径零改动。

## 验收判据（数字）

- 单测：create 路径调用 `AgentSendCommand` 恰好 1 次（blockid=新建块，`submit:true,async:true,wait:true`，
  `waitms≥120000`，text 走 text64）；`registerPendingInput` **不被调用**；抛错路径 `onStatus` 收到 err。
- 真机（扩 `scripts/verify/commontext-send-agent-block` 或 `commontext-send-background`）：
  新建 agent + 发送 → `waveapp.log` 出现 `[agentsend] … submit retries/confirmed`，`submitconfirmed=true`，
  agent 收到并回复；对照：修复前同场景 `[agentsend]` 0 条。

## 不做

- 不删 pending-input 模块与其测试；不动 term.tsx 消费端。
- 不给远端 create 做后端化（远端仍是前端 fallback）。
