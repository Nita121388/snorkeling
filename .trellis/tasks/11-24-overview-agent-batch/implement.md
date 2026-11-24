# implement.md：执行顺序与校验命令

> 配套 `prd.md`（需求/决策）与 `design.md`（方案）。**按阶段做，每阶段跑完判据再进下一阶段。**
> 每条判据都是可直接粘进 cmd.exe 的命令（不使用 bash 专有重定向 —— L-0009 教训）。

---

## 阶段总览

| 阶段 | 内容 | 子任务 | 为什么这个顺序 |
|---|---|---|---|
| P0 | 红证 + 纯函数（phase/超时/unknown 映射） | `agentsend-false-fail` | 用户可见的错，改动面最小，先止血 |
| P1 | 共用方块组件 + 抽离（列表零变化） | `overview-agent-card-fuse` | 先把共用件做出来，P2 才能接线 |
| P2 | 卡片侧改造：方块条 + 去恢复 + 状态 chip | `overview-agent-card-fuse` + `agentsend-status` | 依赖 P1 的组件 |
| P3 | 输入记忆：草稿/prefs 持久化 + 存 CommonText | `overview-input-memory` | 独立，随时可做 |
| P4 | 派发回执可见性 | `agentsend-status` | 依赖 P2 的 chip 位 |
| P5 | 图片粘贴 | `agentsend-image-paste` | 依赖 R4 草稿通道（可选但推荐后置） |

> 赶时间的最小可用集：**P0 + P2 的"去恢复 icon"**（用户抱怨最直接的两条）。其余按序。

---

## P0 发送假失败（`11-24-agentsend-false-fail`）

### P0.1 红证先行（必须先红）

写测试再改实现，先把"错在哪"钉死：

```bash
npx vitest run frontend/app/session-overview/overview-card-send.test.ts
```

新增用例（此时应**失败**）：
1. `outcomeFromSend(null, new Error("EC-TIME: timeout waiting for response")).phase === "unknown"`
2. `cardSendRpcTimeoutMs(60000, true) === 290000`
3. `cardSendRpcTimeoutMs(undefined, false) === 230000`

### P0.2 改纯函数

- `frontend/app/session-overview/overview-card-send.ts`
  - `CardSendPhase` 增 `"unknown"`；
  - `CardSendPhaseLabelKey` / `CardSendPhaseTone` 增 `unknown`（tone = `"warn"`）；
  - 新增 `isSendOutcomeUnknownError(error)`；
  - `outcomeFromSend` 按 design §5.2 的 6 步顺序重排；
  - `cardSendRpcTimeoutMs(replyWaitMs, waitReply)` 改造（design §5.1）。
- `frontend/app/session-overview/overview-card-send-panel.tsx`
  - `:118` 统一用新签名，删除硬编码 `60_000`；
  - unknown 态：草稿不清、渲染「结果未知」徽章、**不渲染重试**，给 [查状态] [继续等]。

### P0.3 判据

```bash
npx vitest run frontend/app/session-overview/overview-card-send.test.ts && echo P0_SEND_OK
```
期望：`P0_SEND_OK`

```bash
npx vitest run frontend/app/session-overview/overview-board.test.ts && echo P0_BOARD_OK
```
期望：`P0_BOARD_OK`

```bash
npx eslint frontend/app/session-overview && echo P0_LINT_OK
```
期望：`P0_LINT_OK`

### P0.4 i18n

zh/en 同步加 `panel.cardSendUnknown`（「结果未知（可能已送达）」）、`panel.cardSendCheckStatus`（查状态）：
```bash
node scripts/i18n/check-parity.mjs && echo P0_I18N_OK
```
期望：`P0_I18N_OK`

---

## P1 共用会话方块组件（`11-24-overview-agent-card-fuse`）

### P1.1 新建 `session-message-squares.tsx`

按 design §2.1 的 props 契约实现。**先只让列表用它**（看板暂不接）。

### P1.2 列表改造（回归红线）

`session-overview.tsx` 的 `MessageSquares` 改为薄封装：保留 loading / error / noSessionId / 无消息文本分支，渲染委托给共用组件。

**验收红线：列表视觉效果必须零变化。**

```bash
npx vitest run frontend/app/session-overview && echo P1_OVERVIEW_OK
```
期望：`P1_OVERVIEW_OK`

---

## P2 卡片改造：方块 + 去恢复 + 状态 chip

### P2.1 去除恢复 icon（先删再加，减少冲突）

照 `design.md §2.4` 删除清单逐项删。全仓确认：

```bash
rg -n "onResumeCard|data-board-restore|canRestore|restoreAgent" frontend scripts docs
```
期望：**无输出**（`BoardCardResumeOutcome` 也应为 0 命中）

### P2.2 方块条接线

- `overview-board-model.ts`：`OverviewBoardCard` 加 `recentMessages` / `messagesOverflow`；
- `session-overview.tsx` `boardCards` useMemo 生成两者（常量 `BoardMessageSquareLimit = 10`）；
- `overview-board.tsx`：`BoardCard` 渲染 `SessionMessageSquares`（surface="board"），新增可选 prop `onOpenMessage`，方块 `stopPropagation`。

判据：

```bash
npx vitest run frontend/app/session-overview/overview-board-message-squares.test.tsx && echo P2_SQUARES_OK
```
期望：`P2_SQUARES_OK`

新测试要覆盖：有消息渲染 N 个方块、超限渲 `+n`、点击回传 seq、无消息不渲染、`data-board-restore` 为 0。

### P2.3 状态 chip

- 新建 `send-status-chip.tsx`（design §4.2）；
- 挂到看板卡 head 与列表行 `block-text`；
- `data-board-send-status` / `data-row-send-status` 供探针。

```bash
npx vitest run frontend/app/session-overview/send-status-chip.test.tsx && echo P2_CHIP_OK
```
期望：`P2_CHIP_OK`

---

## P3 输入记忆（`11-24-overview-input-memory`）

### P3.1 纯逻辑模块

新建 `overview-input-memory.ts`（design §3.1），先写测试：

```bash
npx vitest run frontend/app/session-overview/overview-input-memory.test.ts && echo P3_MEMORY_OK
```
期望：`P3_MEMORY_OK`

覆盖：读写往返、非法值回落、LRU 上限、过期清理、单条超长截断、清除。

### P3.2 接线

- `useCardSendState`：初值读 storage、`setDraft` 防抖 400ms 写、发送成功清除；
- `overview-add-agent-modal.tsx`：profile 记忆 + 校验回落 + message 草稿记忆（成功后清）。

### P3.3 存 CommonText icon

`CardSendPanel` footer 加按钮（design §3.3），`data-overview-card-send-save-commontext`。

```bash
npx vitest run frontend/app/session-overview/overview-card-send-panel.dom.test.tsx && echo P3_PANEL_OK
```
期望：`P3_PANEL_OK`

覆盖：空草稿 disabled、点击调用 upsert、重复内联提示、成功后草稿仍在、不触发发送。

### P3.4 判据汇总

```bash
node scripts/i18n/check-parity.mjs && echo P3_I18N_OK
```
期望：`P3_I18N_OK`

---

## P4 派发回执可见性（`11-24-agentsend-status`）

- `CardSendContext` 增 `dispatchByBlock` / `markDispatching` / `markDispatchReceipt`；
- `submitAddAgent` 建块后立即 `markDispatching(blockId)`；
- `SendStatusChip` 在 `pending|delivering` 时懒拉 `AgentDispatchGetCommand`，3s 重查，上限 40 次；
- `confirmed` → 清草稿 + `submitted`；`failed` → `failed`。

```bash
npx vitest run frontend/app/session-overview/overview-dispatch-status.test.tsx && echo P4_DISPATCH_OK
```
期望：`P4_DISPATCH_OK`

覆盖：queued 后立即有状态、receipt confirmed 推进、重启后无记录不显示"未发送"、重查有上限。

---

## P5 图片粘贴（`11-24-agentsend-image-paste`）

### P5.1 给 `writePasteImage` 加可选 `subdir`

```bash
npx vitest run frontend/app/commontext/commontext-paste-image.test.ts && echo P5_PASTE_OK
```
期望：`P5_PASTE_OK`（含"默认子目录仍是 commontext-images"断言）

### P5.2 composer 接入

`CardSendPanel` 加 `onPaste`（design §7.2），远端块禁用 + 内联提示。

```bash
npx vitest run frontend/app/session-overview/overview-send-paste.test.tsx && echo P5_SENDPASTE_OK
```
期望：`P5_SENDPASTE_OK`

覆盖：图片粘贴落盘并插入 markdown、纯文本不拦截、超限提示、落盘失败无半截引用、远端禁用。

---

## 收尾（每个子任务都要做）

```bash
node scripts/run-task.mjs ...        # 如涉及 Go（本批次默认无）
npx tsc --noEmit -p tsconfig.json    # 只看本次改动文件是否新增错误（基线 58 条）
node scripts/i18n/check-parity.mjs && echo FIN_I18N_OK
npx eslint frontend/app/session-overview frontend/app/commontext && echo FIN_LINT_OK
```

真机验证（UI 改动必做，按 AGENTS.md「真机验证」节）：

```bash
node scripts/verify/index.mjs
node scripts/verify/overview-board/verify.mjs
```

> 探针需新增断言：`[data-board-message-square]` 数量、`[data-board-send-status]` 存在、`[data-board-restore]` 为 0。
> 台账写入 `docs/project/verify-ledger.md`（一行结论），明细进 `verify-runs/`。

---

## 提交纪律

- 每个阶段一个 commit，信息带包号（例：`fix(overview): 发送超时不再谎报失败（N-1124-agentsend-false-fail）`）；
- 一个 commit 只含一个阶段的改动，便于单独 revert；
- 提交前 `git diff --stat` 自查是否越出 touch 白名单（见 `loop/items/N-1124-*.md`）。
