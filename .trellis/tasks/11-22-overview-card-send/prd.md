> **Confirmed: 2026-11-22 @nita**

# PRD：Overview agent 卡点击展开 — 详情 + composer 发送

> 父任务：`11-22-overview-tab-card-ux`。UX：父任务 `ux-ascii.md` §③
> 状态：planning（本轮只落需求，design/implement 在排到时补齐）

## Goal

Overview 里点一张 agent 卡，**原地长高**成「属性 + 最近回复 + 发给它」，输入一句话就能派给该 agent，
并可选等它答完、把回复贴回来。全程不抢焦点、不切 Tab、不弹模态。

## 已拍板 UX 决策

- **A** 主点击 = 展开详情 + composer；跳转保留 `[↪]` 小热区（不抢主点击）。
- 展开态就地替换卡片内容，不弹窗（与 11-02 DialogShell 规范无关，这里是内联态）。
- 发送按钮文案固定 `发送`，行程条用五段：`已入队 → 已注入 → 已提交 → 等回复 → 收到`。
- 失败不弹窗：原地一条 `⚠ <错误码> <一句话> [重试] [改为不等待]`。

## 需求

### R1 展开/收起
- R1.1 点击卡片主体展开；再点 `✕` 或按 `Esc` 收起。
- R1.2 同一时刻只允许一张卡展开（互斥，避免列表被撑乱）。
- R1.3 展开状态不持久化（切视图/重开即收起）。
- R1.4 键盘：`Enter` 发送、`Shift+Enter` 换行；展开后焦点进输入框但**不改激活块/激活 Tab**。

### R2 详情区
- R2.1 属性行：会话 key、model、项目/目录、Tab 名、tags（只读展示，编辑走已有 `AgentCardModal`）。
- R2.2 最近回复：取该会话最后一个 assistant turn 的摘要（复用 `session turns --limit 1` 同源数据），
  带 `[↪ 看全文]` 跳详情。

### R3 发送
- R3.1 复用派发队列（11-21）：`AgentSendCommand`，`Async`/`WaitReply` 二选一，互斥校验已在服务端。
- R3.2 勾选「发送后等回复」→ `WaitReply=true`，`ReplyWaitMs` 默认 60s，UI 显示已等时长；超时按
  `replied=false` 处理（**不算失败**，行程条停在「等回复」并给「继续等 / 取消」）。
- R3.3 三段回执（`queued/sent/confirmed`）来自派发队列事件；`E_AGENT_NOT_READY` 等错误原地展示。
- R3.4 发送内容不做富文本；不做「顺带 commit」（ASCII 里那项本轮不做，见不做项）。

### R4 回复回填
- R4.1 收到回复后在卡片内显示「新回复」块（截断 N 字 + `[↪ 看全文]`），并标记该卡未读。
- R4.2 回复读取失败（索引没跟上）显示 `⚠ reply-empty`，给「重试读取」。

## 验收判据（数字）

1. 单测：展开互斥、`Enter/Shift+Enter` 键位、行程条状态机（queued→sent→confirmed→waiting→received、
   超时、失败三条分支）≥ 6 用例。
2. 真机（`overview-ux` area 第 5-7 条断言）：
   - 点卡片 → 出现 composer 且 `document.activeElement` 在输入框；
   - 发送 `reply with exactly: CARD_OK` + 等回复 → 行程条到「收到」，卡片内出现 `CARD_OK`；
   - 不勾等回复 → 500ms 内行程条停在「已提交」，不阻塞其他卡片点击。

## 依赖

- 11-21 派发队列（已交付 `846f6cb23`/`c0b7fe080`）
- 11-21 roundtrip `--wait-reply`（已交付 `79da4beeb`）
- 分组修复子包先落地（本包 UI 长在新分组上）

## 不做

- 不做富文本/附件/多行模板。
- 不做「顺带 commit」「顺带重启 agent」之类的复合动作（另立包）。
- 不改 `AgentCardModal` 的属性编辑（那是 11-01/11-11 的地盘）。
