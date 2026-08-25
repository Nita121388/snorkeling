# Agent 聊天 · CDP 真机实测报告

- 时间：2026-08-25
- 环境：Snorkeling 真机（Wave Terminal - T1），CDP `http://127.0.0.1:9222`，renderer `http://127.0.0.1:51742/index.html`
- 驱动：`scripts/cdp-agent-chat-test.mjs`（按 `.block-content` 锁定单个 AISessions 块，真实 CDP 输入 focus+insertText 触发 React，页内 `.click()` 触发发送）
- 原始数据：`tests/cdp-agent-chat-raw.md`；截图：`screenshots/cdp-0{1..4}-*.png`
- 假设：会创建带 `CDP_TEST_` / `CDP_DUP_` 标记的消息，便于事后清理。

## 结果总表

| 用例 | 结论 | 证据 |
|---|---|---|
| T-ORD 消息顺序 | ✅ PASS | 16 条 / 2 条会话：seq 严格升序、user/ai 交替正确 |
| 真实输入路径 | ✅ PASS（harness 修正） | `Input.insertText` 后 `sbDisabled:false`；原生 setter+dispatch 不行 |
| T-SND 单次发送启动轮次 | ✅ PASS | `globalStop:true`（Stop 按钮出现，AI 流式响应） |
| T-STP 流式中停止 | ✅ PASS | 点 Stop → 回到 `Send message` |
| T-ST Agent 状态标签 | ✅ 正常 | agent 标签显示 `pi`；模型/思考显示实际值（占位符已被替换） |
| T-SND-DUP 重复发送防护 | ❓ 存疑（e2e 层难定） | 受“后端 busy 静默拒绝 + 新建会话导航”干扰，未能稳定断言 1 vs 2 |
| 后续用户消息是否渲染 | ⚠️ 存疑（疑似缺陷） | 已有会话中单次发送后 AI 回了 seq3/4，但用户自己的消息文本未出现在列表 |

## 逐项详情

### T-ORD 消息顺序
`buildSessionDetailTimeline` 渲染的消息按 `seq` 升序，`roleRuns` 为干净的 `user→ai→user→ai…`。已验证 16 条会话与 2 条会话两种规模。

### T-SND 单次发送 / 状态切换
- 真实输入后按钮启用，点击发送 → 全局出现 `Stop` 按钮（轮次在跑），AI 持续输出（新增 seq3、seq4）。
- 关键观察：**用户自己的消息文本在整轮观测期间（含 turn_end 之后）未出现在消息列表**（`userMsgCount:0`，`__blockOfMarker` 找不到 marker）。AI 确实响应了，说明后端收到了用户输入，但前端列表没把这条用户消息显示出来。
  - 对比：一个会话的**第一条**用户消息是会显示的（早期空会话首条发送后 seq1 用户消息正常出现）。
  - 指向：follow-up 轮次里用户消息可能被 `useLiveTurn`/`clearLiveTurn` + `turn_end` 后的 `requestDetailDelta` 刷新“漏掉”。建议开发跟进（见发现 2）。

### T-STP 停止
流式中点 Stop：`handleAbort` 触发 → 状态回 idle、live turn 清除、刷新落地 → 按钮恢复 `Send message`。✅

### T-ST Agent 状态
composer 的 agent 标签显示 `pi`（与“后端仅实现 Pi”一致）；模型/思考按钮显示实际选中值而非占位文案，符合预期。

### T-SND-DUP 重复发送（存疑）
- 设计：真实输入后**同步两次页内 `.click()`**，意图触发 `handleSubmit` 的异步 `canSubmit` 守卫竞态。
- 实测受阻：两次运行中一次 `stopSeen:false`、marker 未出现；另一次因 UI 已导航到新空会话导致焦点落错块（`taValEnd:""`、`sbDisabled:true`）。
- 根因不在“守卫本身”，而在 e2e 环境的两条噪声（见发现 1、3）。此用例应在**单元测试层**验证更可靠（见建议）。

## 两个实质发现（建议开发跟进）

### 发现 1 · 后端 busy 态不反映在前端 Send 按钮
多次出现“Send 按钮可点、点击后无任何轮次（无 Stop、无用户消息）”。结合 `usechat-backend.go` 的 allowlist 逻辑（`agent is busy` 时普通 send 被拒），判断为：**UI 回到 idle（Send 显示）后，后端会话仍可能处于 busy**，此时发送被静默拒绝。
- 影响：用户点了发送却“什么都没发生”，无错误提示。
- 建议：`use-sessions-running` 的 running 态（订阅 `controllerstatus`）应驱动 composer 的 `canSubmit`/禁用态；或在发送被拒时回显 `turn_failed` 错误。

### 发现 2 · follow-up 用户消息可能不渲染
已有会话中后续发送，AI 正常回复但用户自身消息不出现在列表（仅首条用户消息显示）。疑似 `clearLiveTurn` 清空临时流块后，`turn_end` 的 `requestDetailDelta` 刷新未把该轮用户消息纳入。
- 影响：对话里“自己的话”丢失，严重 UX 问题。
- 建议：核对 `session-detail.tsx` 的 `handleChatEvent`（`turn_end` → `requestDetailDelta("bottom").finally(clearLiveTurn)`）与后端 delta 的 `resetRequired`/cursor 逻辑，确保每轮用户消息被持久化并渲染。

### 发现 3 · 空 composer 发送会新建会话并导航
从空 `sessionId` 的 composer 发送 → 后端新建会话、前端跳转，活动块位置变化。这是 e2e 观察难得稳定的主因，也提示：**在同一会话内连续发送（不新建）**才是常规路径，测试需跟随导航或固定到已有会话。

## 后续建议
1. **重复发送防护**改为 vitest：直接对 `useChatStream.send` 做“同步两次调用”断言（应只产生一次 fetch / 一个用户消息），比 CDP e2e 稳定。同时可补一个同步 `submittingRef` 守卫消除异步 `canSubmit` 竞态。
2. **发现 1、2** 交给前端/后端开发按上面线索排查；可用本驱动脚本复现（调大 `driveSend` 的等待窗口即可观察 turn_end 后的最终列表）。
3. 清理：本测试在会话里留下的 `CDP_TEST_*` / `CDP_DUP_*` 消息，建议手动删除或加清理用例。

## 截图
- `screenshots/cdp-01-recon.png` — 初始 AISessions 视图
- `screenshots/cdp-02-dup.png` — 重复发送尝试后
- `screenshots/cdp-03-after-send.png` — 单次发送、流式进行中
- `screenshots/cdp-04-after-stop.png` — 停止后
