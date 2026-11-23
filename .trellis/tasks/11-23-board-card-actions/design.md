# Design：看板卡补「恢复」+ composer 浮层

> PRD：本任务 `prd.md`（D1=A / D2=浮层）。UX 参照父任务 `ux-ascii.md` §③（列表行那套，改浮层）

## 1. 边界

纯前端；后端能力全现成（`AgentResumeCommand` / `AgentSendCommand`）。

改动落点：
- `frontend/app/session-overview/overview-board-card-actions.ts`（新，纯函数：能力判定）
- `frontend/app/session-overview/overview-card-send-panel.tsx`（新，从 `session-overview.tsx` 的
  行内 composer 抽出的共享面板；列表 variant="inline"、看板 variant="popover"）
- `frontend/app/session-overview/overview-board.tsx`（卡动作区两枚热区 + 浮层挂载）
- `frontend/app/session-overview/session-overview.tsx`（列表行改用共享面板；提供 `onResumeCard` 处理）
- `session-overview.scss`（浮层与热区样式）、i18n

## 2. 能力判定（纯函数，可单测）

```ts
export interface BoardCardCapabilities { canSend: boolean; canRestore: boolean; }
export function boardCardCapabilities(card: {
    isAgentLike: boolean; sessionId: string; blockId: string;
}): BoardCardCapabilities
```

规则（**顺序固定**）：
- 非 agent 卡 → `{canSend:false, canRestore:false}`。
- agent 卡但 `sessionId === ""`（没有可恢复的会话、也没有投递目标）→ 两者 false。
- agent 卡且 `sessionId !== ""` → 两者 true（块是否存活不参与判定：`AgentSendCommand` 会
  `ensureSendBlockController` 重启控制器；`AgentResumeCommand` 按会话重建块）。

## 3. 恢复（D1=A）

```ts
RpcApi.AgentResumeCommand(TabRpcClient, {
    identifier: card.sessionId,      // 会话 key/id（精确匹配）
    tab: card.tabId,                 // 恢复到卡片所在 Tab
    nofocus: true,
    wait: true,
    waitms: 8000,
}, { timeout: 60000 })
```

- 成功后 `refreshSeqAtom++`（组会带出新块）；卡片就地变活卡（新块 id 不同，旧卡仍在 —— 属预期，
  文档写明"恢复=再开一个块"，不是"替换"）。
- 失败：卡片内联 `⚠ <code> <msg> [重试]`，不弹窗。
- 按钮 aria-label 带会话名；`stopPropagation`，不触发卡片主体点击。

## 4. composer 浮层（D2=浮层）

从 `session-overview.tsx` 现有行内组件抽出 `CardSendPanel`：

```tsx
<CardSendPanel
    blockId={card.blockId}
    variant="popover" | "inline"
    defaultWaitReply={true}
    autoFocus
    onClose={() => setPanelOpen(false)}
/>
```

- 内部逻辑**不复制**：请求组装 `buildCardSendRequest`、超时 `cardSendRpcTimeoutMs`、
  结果映射 `outcomeFromSend`、失败重试/改为不等待，全部来自 `overview-card-send.ts`。
- `variant="popover"`：FloatingPortal + 定位到卡片右上（`placement:"bottom-end"`，`strategy:"fixed"`），
  宽 320px，`max-height:60vh`；点外部 / Esc 关闭；`modal={false}` 不抢焦点。
- `variant="inline"`：现有行内展开体保持不变（只搬家，不改样式类名）。
- 同一时刻：看板最多一个浮层打开（面板级 state）。

## 5. 热区纪律

卡动作区已有 jump / delete；新增：
- 恢复：`data-board-restore`，图标 `arrow-rotate-right`
- 发消息：`data-board-send`，图标 `paper-plane`
两者都在 `.session-overview-board-card-actions` 容器内（该容器已 `stopCardEvent`）。

## 6. i18n

`board.restoreAgent`「恢复」/ `board.restoreAgentAria` / `board.sendMessage`「发消息」/
`board.sendMessageAria` / `board.restoreFailed`「恢复失败」/ `board.sendFailed`「发送失败」。

## 7. 测试

- `overview-board-card-actions.test.ts`：四组（非 agent / agent 无 session / agent 有 session /
  空 blockId）→ 能力矩阵。
- `npx vitest run frontend/app/session-overview` 全绿（现有 275 不许掉）。
- 像素/交互回归：`scripts/verify/overview-board` 不退化；用户手动点一次恢复 + 发一条消息。
