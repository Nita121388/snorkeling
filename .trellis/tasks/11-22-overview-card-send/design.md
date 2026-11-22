# Design：Overview 卡片展开 + composer 发送

> PRD：本任务 `prd.md`。UX：父任务 `ux-ascii.md` §③

## 1. 边界（本轮收窄，写死）

- **只做列表视图**（`TabGroupSection` → `BlockRow`）。看板卡（`overview-board.tsx`）本轮不动，
  因为看板列窄、展开会把列撑变形；下一轮再用同款组件接入。
- 后端零改动：`AgentSendCommand` 已带 `submit`/`waitreply`/`replywaitms`/`replychars`，
  返回 `AgentSendResult`（`injected/submitted/submitconfirmed/replied/turn/replytext/warnings`）。
- 新增纯函数模块 `overview-card-send.ts`（无 React/jotai），负责请求组装与结果映射；
  UI 只做状态与渲染。

## 2. 为什么 v1 行程条是三段而不是五段

`async:false` 的一次 RPC 在服务端内部走完「入队→注入→提交确认→等回复」，客户端只见首尾。
要逐段实时显示，必须 `async:true` + 订阅 `AgentDispatch*` 事件流（另一套状态机）。
v1 取三段：`等待中 → 已提交 / 未确认 → 收到回复`，并把 `warnings` 原样透出。
（ASCII 里五段是目标形态，实现拆两步；本包 prd 的 R3.3 据此降级，剩余部分后续包。）

## 3. 纯函数契约

```ts
export type CardSendPhase =
    | "sending"     // 请求在飞
    | "submitted"   // ok && submitconfirmed
    | "unconfirmed" // ok && !submitconfirmed（文本在输入框里，没吃到回车）
    | "replied"     // replied=true（已拿到回复）
    | "timeout"     // warnings 含 reply-timeout / reply-rpc-deadline
    | "failed";     // 抛错（E_AGENT_NOT_READY 等），带 code + message

export interface CardSendResult {
    phase: CardSendPhase;
    replyText: string;
    truncated: boolean;
    turn: number;
    waitedMs: number;
    warnings: string[];
    errorCode: string | null;   // failed 时从 "E_XXX: ..." 里取
    errorMessage: string | null;
}

export function outcomeFromSend(rtn: AgentSendResult | null, error?: unknown): CardSendResult
export function buildCardSendRequest(args: {
    blockId: string;
    text: string;
    waitReply: boolean;
    replyWaitMs?: number;
    replyChars?: number;
}): { ok: true; req: AgentSendRequest } | { ok: false; error: string }
```

映射顺序（不可调换）：
1. 抛错 → `failed`（`errorCode` 取消息前缀 `E_[A-Z_]+`）。
2. `replied === true` → `replied`。
3. `warnings` 含 `reply-timeout` / `reply-rpc-deadline` → `timeout`（**不算失败**）。
4. `submitconfirmed === true` → `submitted`。
5. 其余 ok → `unconfirmed`。

`buildCardSendRequest`：
- 空文本 → `{ok:false, error:"empty"}`（UI 禁发送）。
- `waitReply=true` 时**绝不**带 `async`（服务端会 E_USAGE）；`replyWaitMs` 夹 [5000, 300000]，
  `replyChars` 夹 [200, 8000]。
- 文本走 `text64`（`stringToBase64`），不用裸 `text`（避免多字节/换行被截断）。

## 4. UI 状态与交互（`BlockRow`）

新增本地 state（不持久化，不跨卡共享）：

```ts
const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null); // 面板级，互斥
const [draftByBlock, setDraftByBlock] = useState<Record<string, string>>({});
const [sendByBlock, setSendByBlock] = useState<Record<string, CardSendResult | "sending">>({});
const [waitReply, setWaitReply] = useState(true);
```

- 点击行主体（非热区）→ `setExpandedBlockId(block.blockId)`；再点或 `✕`/`Esc` → null。
- 只有 `isAgentLike && sessionId` 的行可展开；其余行点击行为不变。
- 展开体（在行下方）：
  - 属性行：会话 key（截断）、model、Tab 名（只读）。
  - 最近回复：复用行的 last-message 摘要 + `[↪ 看全文]`（跳详情，已有回调）。
  - composer：textarea（Enter 发送 / Shift+Enter 换行）+ 勾选「发送后等回复」+ `发送`。
- 发送中：按钮变 spinner + 已等秒数；完成：行程条徽章（phase → 文案/颜色）。
- 失败：`⚠ <code> <message> [重试]`，原地替换，不弹窗。
- `E_AGENT_NOT_READY`：额外给 `[改为不等待]`（重发 `wait:false, waitreply:false`）。

**热区纪律**（防止误触发，看板卡踩过）：行内已有 `跳转/备注/关闭` 按钮，全部 `stopPropagation`；
展开只在"行主体空白区"生效。现有 `[↪]` 小热区保留。

## 5. i18n

`panel.cardSendTitle`「发给它」/ `cardSendPlaceholder` / `cardSendSubmit`「发送」/
`cardSendWaitReply`「发送后等回复」/ `cardSendSending`「发送中 {secs}s」/
`cardSendSubmitted`「已提交」/ `cardSendUnconfirmed`「未确认提交」/
`cardSendReplied`「收到回复」/ `cardSendTimeout`「等回复超时，可继续等」/
`cardSendFailed`「发送失败」/ `cardSendRetry`「重试」/ `cardSendNoWait`「改为不等待」。
中英同步。

## 6. 测试

- `overview-card-send.test.ts`：映射 6 条分支（含 `submitconfirmed:false`、`reply-timeout`、
  `E_AGENT_NOT_READY` 取码）+ 请求组装（空文本 / 夹取 / 不带 async）+ 10 条断言。
- DOM 测（可选）：展开互斥、Esc 收起、Enter/Shift+Enter。

## 7. 回滚

纯前端：新模块 + `BlockRow` 局部改动。revert 单 commit 即回滚。
