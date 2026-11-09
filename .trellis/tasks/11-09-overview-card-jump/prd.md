# Overview agent 卡片跳转到对应 agent block

> Confirmed: 2026-11-09 @nita（方案 A 已批准）

## Goal

Overview 看板里的 agent 卡片目前唯一的主交互是「点开整卡弹窗」，没有任何入口回到**该会话真正所在的 agent block**。
列表视图早就有「Jump to block」（`location-crosshairs` → `jumpToBlock`），看板缺这条路径。
本次给看板 agent 卡片补「定位到块」，并在整卡弹窗里也提供同一动作；顺手修掉卡片动作区的乱码 tooltip。

## 做什么

### R1 看板卡片「定位到块」按钮

- `BoardCard` 首行右侧动作区（现有 `×` / `🗑` 同一排，hover / focus-within 才显形）新增一枚
  `location-crosshairs` 按钮，`data-board-jump`，tooltip 文案与列表行一致（`Jump to block`）。
- 点击触发新 prop `onJumpCard(card)`，必须 `stopPropagation`，**不得**同时触发 `onOpenCard`。
- 卡片本体单击语义**保持不变**（agent 卡 → `AgentCardModal`，非 agent 卡 → `jumpToBlock`）。
- `onJumpCard` 未传时按钮不渲染（缺省不改变现有面）；`card.tabId === ""` 时也不渲染（无处可跳）。

### R2 接线

- `session-overview.tsx` 传 `onJumpCard={(card) => { markBlockViewed; overviewModel.jumpToBlock(card.tabId, card.blockId); }}`。
- 复用既有 `jumpToBlock`（`setActiveTab` + block highlight + `refocusNode`），**不新增 RPC**。

### R3 AgentCardModal footer「跳转到块」

- `AgentCardModal` footer 在「打开会话详情」左侧加「跳转到块」按钮：先 `popModal()` 再 `jumpToBlock`。
- tabId 解析：优先用新增可选 prop `tabId`（Overview 传入）；未传时用 `atoms.workspace` 反查 block 所在 tab
  （这样从 term 悬浮卡放大进来的弹窗也能跳）；两者都取不到 → 按钮 disabled 并给出 title 说明。

### R5 打开整卡详情的空白期（用户补充报告：慢）

- 调查结论（CDP 实测）：点卡片 → 弹窗 DOM 5ms 内出现，但内容是**空壳**（header 空标题 +
  只有 provider 行），`Summary` RPC 回来后（实测 180~400ms，远端更久）才整体弹入。
  根因是两份独立缓存：看板数据在 `session-overview-session-cache`，弹窗数据在 `session-note-cache`，
  点开时后者是冷的 → 重新发一次 RPC。
- 修复：`session-note-cache` 新增 `primeSessionNote(sessionId, summary, connection)`；
  Overview 打开整卡前用看板已有的 `SessionSummary` 预置，弹窗第一帧即有完整标题/note/tags。
  不覆盖新鲜 loaded 条目、不抢跑 in-flight 请求，TTL 后仍走原后台刷新。

### R4 顺手修乱码

- `overview-board.tsx` 两处 action tooltip 是 `title="????"` / `title="??"`（commit `b3507553` 引入的编码损坏），
  改成正确中文文案（关闭块 / 删除会话文件）。

## 不做什么

- 不改卡片单击语义（不同步改 `card-click-opens-agent-dialog` 等 4 条真机判据）。
- 不改时间线视图的点击语义；不加新的 jump 入口。
- 不动 `jumpToBlock` 内部实现。

## Acceptance Criteria

- [ ] AC1 看板 agent 卡片 hover 后出现 `[data-board-jump]` 按钮，列表行同名动作文案一致。
- [ ] AC2 点击该按钮只触发 `onJumpCard`，不打开 `AgentCardModal`（`stopPropagation` 生效）。
- [ ] AC3 未传 `onJumpCard` 时卡片不渲染该按钮（既有用例与既有渲染产物不变）。
- [ ] AC4 `AgentCardModal` footer 有「跳转到块」，点击后弹窗关闭且激活目标 tab。
- [ ] AC5 `overview-board.tsx` 不再出现 `title="??"` 形态的乱码。
- [ ] AC7 点卡片打开整卡时，首帧即渲染标题与 note 区（`primeSessionNote` 命中，vitest 断言
      「预置后同步可读且不发 RPC」）。
- [ ] AC6 判据：`npx vitest run frontend/app/session-overview/overview-board.test.ts` 全绿（含新增 3 例）；
      `node scripts/verify/overview-board/verify.mjs` 出口码 0，既有 43 条 check 不退化，新增 2 条真机 check 全绿；
      台账 `docs/project/verify-ledger.md` 追加一行。
