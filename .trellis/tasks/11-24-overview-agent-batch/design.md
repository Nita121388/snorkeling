# design.md：Overview agent 卡融合与发送链路批次

> 配套 `prd.md`（需求与决策）。本文只讲**怎么实现**：模块边界、数据流、每条的落点与理由。
> 所有路径相对仓库根 `E:/code/snorkeling`。

---

## 1. 现状结构（开发前必须建立的模型）

```
session-overview.tsx（视图容器）
├─ 数据层（都在这个文件里，均为 useMemo）
│  ├─ displayedTabGroups        Tab 分组（列表用）
│  ├─ boardBlocks               = groups 扁平 + shouldShowFullOverviewBlock 过滤
│  ├─ details / summaries       会话明细与摘要（useSessionDetails / summaries atom）
│  ├─ boardCards: OverviewBoardCard[]   ← 看板唯一数据源（:2922）
│  └─ timelineRows              复用 boardCards
├─ 列表视图 → TabGroupSection → BlockRow → MessageSquares（:1257）
└─ 看板视图 → <OverviewBoard cards={boardCards} …/>（:3344）
                └─ BoardCard（memo，overview-board.tsx）
                     ├─ 右上动作区：恢复 / 发消息 / 定位 / 删除 / 关闭
                     ├─ body：preview 文本、tags、props、note、SessionMetrics、mini timeline
                     └─ composer 由看板级单一浮层 BoardSendPopover 承载（FloatingPortal）

发送链路（唯一实现，两视图共用）
overview-card-send-panel.tsx
├─ useCardSendState()     面板级状态：expandedBlockId / draftByBlock / sendByBlock / sendingStartedAt / waitReply
├─ CardSendContext         消费方：BlockRow（inline）、BoardCard→BoardSendPopover（popover）
└─ CardSendPanel           纯 UI（textarea + 勾选 + 徽章 + 发送 + 失败/超时逃生口）
    └─ 纯函数在 overview-card-send.ts：buildCardSendRequest / outcomeFromSend / CardSendPhaseTone
```

**关键事实（已核实，勿重复调研）**

| 事实 | 位置 |
|---|---|
| 看板卡已拿到 messages，但只取最后一条做 preview | `session-overview.tsx:2937-2940` |
| 方块条目前只有一处实现 | `session-overview.tsx:1257-1323` |
| 恢复按钮与全部配套状态 | `overview-board.tsx:158-181, 301-330, 415-435, 480-505` |
| 恢复能力位 | `overview-board-card-actions.ts:22-40` |
| 恢复上层接线 | `session-overview.tsx:2821-2860, 3356` |
| 派发回执 API 已存在 | `wshclientapi.ts:58,64`；Go `agentdispatch_rpc.go:122,126` |
| 派发记录结构 | `pkg/agentdispatch/agentdispatch.go:36-55` |
| 派发 Store 纯内存（重启即丢） | `pkg/agentdispatch/agentdispatch.go:57-66` |
| 客户端超时错误串 | `wshrpcutil-base.ts:28` → `EC-TIME: timeout waiting for response` |
| 客户端超时预算 | `overview-card-send.ts:58-64`（80s）；`overview-card-send-panel.tsx:118`（60s） |
| 服务端预算常量 | `agentsend.go:29-58`（30s / 180s / 60s） |
| 图片粘贴纯函数全家桶 | `commontext-paste-image.ts`（`pickPastedImages`/`validatePasteImage`/`writePasteImage`/`buildPasteImageMarkdown`/`spliceTextAtRange`/`materializePastedImages`） |

---

## 2. R1 + R2：看板卡与列表融合（子任务 `11-24-overview-agent-card-fuse`）

### 2.1 抽共用组件（R1 核心，防两份实现漂移）

新增 `frontend/app/session-overview/session-message-squares.tsx`：

```ts
export type SessionMessageSquareItem = { seq: number; role: string; preview: string; label: string };
export function SessionMessageSquares(props: {
    surface: "row" | "board";
    items: readonly SessionMessageSquareItem[];
    overflow: number;          // 已裁掉的条数（渲染 +n）
    unreadText?: string;
    loading?: boolean;
    emptyText?: string;
    errorText?: string;
    onOpen: (seq: number) => void;
})
```

- 渲染结构与 class 名沿用现有 `.session-overview-message-square` / `.session-overview-more`，**新增** `data-board-message-square`（仅 surface="board" 时）供 verify 探针使用；
- 列表 `MessageSquares` 改为**薄封装**：负责 loading / error / noSessionId 文本与 `readableMessages`，渲染交给共用组件 → 列表视觉零变化（这是回归红线）；
- 看板卡直接消费共用组件。

### 2.2 数据进卡片模型

`OverviewBoardCard`（`overview-board-model.ts:340`）新增两个字段：

```ts
/** 最近消息（方块条数据源）：已裁剪到上限，不含全文。 */
recentMessages: readonly { seq: number; role: string; preview: string; label: string }[];
/** recentMessages 之前被裁掉的消息数（渲染 `+n`）。 */
messagesOverflow: number;
```

生成点在 `session-overview.tsx` 的 `boardCards` useMemo（消息已在那里算出，零额外请求）：

```ts
const messages = readableMessages(details[nextBlock.sessionId]?.detail ?? null);
const limit = BoardMessageSquareLimit;          // 常量，默认 10
const recent = messages.slice(-limit).map(m => ({ seq: m.seq, role: m.role, preview: messagePreview(m), label: … }));
recentMessages: recent,
messagesOverflow: Math.max(0, messages.length - recent.length),
```

理由：`boardCards` 的 deps 已含 `details`，不新增订阅；`BoardCard` 是 `memo`，只有该卡 detail 变才会重渲。

### 2.3 卡片内位置与交互

- 位置：`session-overview-board-card-meta` **之前、head 之后**（方块条是"内容"，不是元信息）；
- 点击方块 → `onOpenMessage(card.blockId, message)`：看板需要新的可选 prop
  `onOpenMessage?: (card: OverviewBoardCard, seq: number) => void`，由 `session-overview.tsx` 接到现有 `openSessionDetail`/消息弹窗链路；
- 方块必须 `stopPropagation`，否则会触发 `handleCardClick` 开卡片弹窗；
- 无消息时不渲染该行（不留空行，卡高不跳）。

### 2.4 移除恢复（R2）删除清单（照单全删，不留死代码）

| 文件 | 要删 |
|---|---|
| `overview-board.tsx` | `onResumeCard` prop 两处（Board 与 BoardCard）、`BoardCardResumeOutcome` 类型、`canRestore` 判定与 `showRestore`、`runRestore`/`restoring`/`restoreError`、恢复按钮 JSX、`data-board-restore-error` 内联块、传给 BoardCard 的 prop |
| `session-overview.tsx` | `handleResumeBoardCard` 整个 useCallback、`onResumeCard={handleResumeBoardCard}` |
| `overview-board-card-actions.ts` | `canRestore` 字段（先全仓搜确认只剩看板卡用） |
| i18n | `board.restoreAgent` / `board.restoreAgentAria` / `board.restoreFailed`（zh + en 同步删，`i18n:check` 会拦不对称） |
| 测试 | `overview-board-card-actions.test.ts` 改为断言"不提供恢复能力"；`overview-board-hotzones.test.tsx` 若含恢复热区一并调整 |

**保留**：`AgentResumeCommand` RPC、`aisessions.tsx restoreSession`（AISessions「恢复到终端」入口）。

---

## 3. R3 + R4 + R5：输入记忆与存 CommonText（子任务 `11-24-overview-input-memory`）

### 3.1 持久化通道选择（D2）

| 方案 | 取舍 |
|---|---|
| settings（`SetConfigCommand`，与 CommonText 同族） | 跨设备同步，但每次写都走 RPC + 落配置文件，**逐键写不合适**，且会污染 wconfig 结构（要加 Go 字段） |
| **localStorage（采纳）** | 便宜、同步写、够用；先例：`displayLimit`/`viewMode`/`blockViewedAt`（`session-overview-model.ts:121-128`） |

新增 `frontend/app/session-overview/overview-input-memory.ts`（纯逻辑 + storage 适配，可单测）：

```ts
export const OverviewSendDraftStorageKey = "sessionoverview:senddrafts";     // { [blockId]: { text, updatedAt } }
export const OverviewAddAgentPrefsStorageKey = "sessionoverview:addagent";   // { profile?: string, message?: string }
export function readSendDraft(storage, blockId): string
export function writeSendDraft(storage, blockId, text, now): Record<…>       // 防抖在调用侧
export function pruneSendDrafts(record, { now, maxEntries, maxAgeMs }): …     // LRU + 过期
export function clearSendDraft(storage, blockId): …
export function readAddAgentPrefs(storage): { profile: string | null; message: string }
export function writeAddAgentPrefs(storage, prefs): void
```

规则：`maxEntries = 50`，`maxAgeMs = 14 天`，单条文本上限 8KB（超出截断并记一次日志，不丢用户可见部分）。

### 3.2 接入点

- `useCardSendState`（`overview-card-send-panel.tsx:78`）：
  - 初值 = `pruneSendDrafts(readAll())`；
  - `setDraft` 内 `debounce 400ms` 落盘（引用镜像已有 `draftRef`，直接复用）；
  - 发送成功（`outcome.phase !== "failed"`，现有分支 `:124`）时 `clearSendDraft(blockId)` —— **注意 R8 会新增 `unknown` 态，unknown 同样要清不了稿？→ 语义：unknown 保留草稿但标记"已发出待确认"，见 §5.3**；
  - 面板卸载不写、不读（状态还在 context 里）。
- `overview-add-agent-modal.tsx`：
  - `profileName` 初值 = `readAddAgentPrefs().profile`，渲染时**校验**该值是否在 `profileOptions` 内，不在则回落 `profileOptions[0]`；
  - `message` 初值 = prefs.message；`submit()` 成功后清 prefs.message（建块失败保留）；
  - 每次选择变化即写 prefs（无需防抖，低频）。

### 3.3 存 CommonText（R5）

- `CardSendPanel` footer 新增按钮：
  - `data-overview-card-send-save-commontext={blockId}`；
  - `disabled = draftEmpty`；
  - 点击 → `upsertCommonTextItem({ title: "", text: draft })`（`commontext-model.ts:717`）；
  - 结果内联：
    - 成功 → `session-overview-card-send-badge is-ok` + 文案「已存到 CommonText」（3s 后自动消失）；
    - 重复（错误信息含 `Common text already exists`）→ `is-warn` + 「已存在，未重复保存」；
    - 其他错误 → `is-danger` + 错误首行；
  - **绝不清草稿、绝不发送**；
  - `stopPropagation`，不触发外层卡片点击。

i18n 新增（zh/en 同步）：`panel.cardSendSaveCommonText` / `…Saved` / `…Duplicate` / `…Failed`。

---

## 4. R6：发送状态常驻（子任务 `11-24-agentsend-status`）

### 4.1 单一映射表（先补齐 phase）

`overview-card-send.ts` 扩展 `CardSendPhase`：

```ts
export type CardSendPhase = "sending" | "submitted" | "unconfirmed" | "replied" | "timeout" | "unknown" | "failed";
CardSendPhaseLabelKey: 新增 unknown → "session-overview:panel.cardSendUnknown"
CardSendPhaseTone:     unknown → "warn"（不是 danger：没失败，只是不知道）
```

### 4.2 显示位置

新增 `SessionSendStatusChip`（新文件 `frontend/app/session-overview/send-status-chip.tsx`）：

```tsx
export function SendStatusChip(props: { blockId: string; surface: "board" | "row" });
```

- 内部 `useContext(CardSendContext)` 读 `sendByBlock[blockId]` / `sendingStartedAt[blockId]`；
- 无记录 → 渲染 `null`（不占位）；
- `sending` → 复用 `useSendingSeconds` 显示秒数；
- 终态（`submitted`/`replied`）→ **3s 后自动隐藏**（本地 timer，不写 store）；
- 挂点：
  - 看板：`BoardCard` 的 `head` 右侧（age 之前），`data-board-send-status={phase}`；
  - 列表：`BlockRow` 的 `.session-overview-block-text`（`AgentStatusChip` 之后），`data-row-send-status={phase}`。
- 点击 chip → 打开该卡 composer（看板：`onOpenSendPanel`；列表：`cardSend.toggleExpanded`），并 `stopPropagation`。

### 4.3 为什么不用轮询

`sendByBlock` 已由发起方写入进展，R7 的回执查询只在"派发中"阶段按需拉一次（见 §5.4），不引入常驻轮询。

---

## 5. R8：假失败修复（子任务 `11-24-agentsend-false-fail`，**优先做**）

### 5.1 超时预算重算

`overview-card-send.ts` 新增：

```ts
export const AgentSendServerWorstCaseMs = {
    waitMs: 30_000,        // agentsend.go DefaultSendWaitMs
    submitWaitMs: 180_000, // DefaultSubmitWaitMs
    marginMs: 20_000,
};
export function cardSendRpcTimeoutMs(replyWaitMs?: number, waitReply = true): number {
    const reply = waitReply ? clamp(replyWaitMs ?? 60_000, 5_000, 300_000) : 0;
    // 注入前的两段预算（安静等待 + 提交确认）始终存在，等回复窗口只在 waitReply 时叠加。
    const total = 30_000 + 180_000 + reply + 20_000;
    return Math.min(360_000, total);   // 上限从 320s 提到 360s，覆盖 290s 最坏值
}
```

调用点改造 `overview-card-send-panel.tsx:118`：不再对非等回复路径硬编码 60s，统一用 `cardSendRpcTimeoutMs(req.replywaitms, useWaitReply)`。

> 若夜班实测认为 210s+ 的"发送中"体验太差，**先做 §5.2/§5.3 的语义修复**（那才是用户看到的错），预算只做"不假杀"的下限保障，不要为了体验把预算缩回去。

### 5.2 错误分类（核心）

`overview-card-send.ts` 新增纯函数：

```ts
/** 客户端侧超时/取消：请求可能已经生效，结果未知 —— 绝不能当成发送失败。 */
export function isSendOutcomeUnknownError(error: unknown): boolean {
    const msg = errorText(error);
    return /EC-TIME: timeout waiting for response/i.test(msg)
        || /context deadline exceeded/i.test(msg)
        || /EC-CTXT|EC-CANCEL/i.test(msg);
}
```

`outcomeFromSend` 判定顺序改为（**顺序即契约，测试锁死**）：

1. `error != null && isSendOutcomeUnknownError(error)` → `phase: "unknown"`，`errorMessage` = 原始串，`errorCode = null`；
2. `error != null` → `phase: "failed"`（真失败，`E_XXX` 取码）；
3. `rtn.replied === true` → `replied`；
4. warnings 含 `reply-timeout`/`reply-rpc-deadline` → `timeout`；
5. `submitconfirmed === true` → `submitted`；
6. 其余 → `unconfirmed`。

### 5.3 草稿与重复投递防护

- `unknown` 态**保留草稿但打标**：`draftByBlock` 里额外记 `{ pendingBlockIds }`（新增 context 字段 `sentUnknownByBlock: Record<string, true>`）；
- UI 在 unknown 态：
  - 徽章文案「结果未知（可能已送达）」；
  - 动作只给 **[查状态]**（读派发回执 + 刷新 detail）与 **[继续等]**；
  - **不渲染** [重试]（这是防重复投递的关键，`tests` 锁死）；
  - 若用户在 unknown 态强行再输入并发送 → 二次确认（`ConfirmModal`，文案说明可能重复投递）。

### 5.4 [查状态] 的实现

```ts
const list = await RpcApi.AgentDispatchListCommand(TabRpcClient, { blockid: card.blockId, limit: 1 });
```
- `state === "confirmed"` → 追加一次 `reload()`，把行程改 `submitted`（并清草稿）；
- `state === "failed"` → `failed` + 可重试；
- 无记录（可能内存已丢/非 async 派发）→ 退化为「刷新会话看是否出现新回合」：`reload()` 后比对 `summary.messageCount` 是否增长，增长即视为已送达。

### 5.5 测试（红证先行）

`overview-card-send.test.ts` 增：
- `EC-TIME` 错误 → `phase === "unknown"`（不是 failed）；
- `E_BLOCK_NOT_READY` → `failed` 且 `errorCode` 正确；
- `cardSendRpcTimeoutMs(60000, true) === 290000`；
- `cardSendRpcTimeoutMs(undefined, false) === 230000`；
- unknown 态草稿不被清。
DOM 测试：unknown 徽章存在、`[data-overview-card-send-retry]` 数量 = 0。

---

## 6. R7：异步派发可追溯（并入 `11-24-agentsend-status`）

### 6.1 建块后立即建立本地行程

`session-overview.tsx submitAddAgent`：拿到 `blockId` 后立刻向 `CardSendContext` 写一条 `sending`（新增 context 方法 `markDispatching(blockId)`），让卡片**立刻**出现"正在派发"。

```ts
const sendResult = await RpcApi.AgentSendCommand(...);
// queued=true, dispatchid=…
if (sendResult?.queued) markDispatchReceipt(blockId, { dispatchId: sendResult.dispatchid, state: "pending" });
```

### 6.2 回执推进

- `CardSendState` 增 `dispatchByBlock: Record<string, { dispatchId: string; state: string; updatedAt: number }>`；
- 派发中（`state in {pending, delivering}`）时，`SendStatusChip` 懒拉一次 `AgentDispatchGetCommand`，之后按 `setTimeout` 3s 重查，**最多 40 次或 5 分钟**后停止（不引入全局轮询）；
- `confirmed` → 清草稿 + 状态转 `submitted`；`failed` → `failed` + `error`。

### 6.3 已知限制（写进实现注释，避免后人误判）

`pkg/agentdispatch` 纯内存，**应用重启后回执消失**（D4）。表现为：重启后卡片不再显示历史派发状态，但消息可能已送达。UI 不得因此显示"未发送"。

---

## 7. R9：图片粘贴（子任务 `11-24-agentsend-image-paste`）

### 7.1 落盘目录（D3）

`commontext-paste-image.ts` 的 `PASTE_IMAGE_SUBDIR` 是常量 `commontext-images`。不修改该常量（会连带影响 CommonText），改为在本批次新增薄适配：

```ts
// overview-send-paste.ts
export const OverviewSendImageSubdir = "overview-send-images";
export async function materializeOverviewSendImages(blobs: Blob[]): Promise<PasteImageInsertResult>
// 内部调用 writePasteImage(blob, { dataDir }) —— 需要 writePasteImage 支持自定义子目录：
```

因此需给 `writePasteImage` 增加可选 `subdir?: string`（默认保持 `PASTE_IMAGE_SUBDIR`，CommonText 行为零变化），并补一条单测锁默认值。

### 7.2 接入 `CardSendPanel`

```tsx
onPaste={(event) => {
    const blobs = pickPastedImages(event.clipboardData?.items);
    if (blobs.length === 0) return;              // 纯文本走浏览器默认
    event.preventDefault();
    void insertImagesAtCaret(blobs);
}}
```

`insertImagesAtCaret`：
1. `const { markdown, written, failures } = await materializeOverviewSendImages(blobs)`；
2. `markdown !== ""` → `spliceTextAtRange(draft, caretStart, caretEnd, markdown)` 写回 `setDraft`（走 R4 的持久化通道，天然落盘）；
3. `failures.length > 0` → 内联 `is-warn` 提示（复用 `session-overview-card-send-alert`，不弹窗）；
4. 插入后把光标放到插入串末尾（`requestAnimationFrame` 内 `setSelectionRange`）。

### 7.3 边界

- 非图片粘贴（`blobs.length === 0`）**不 preventDefault**，保证纯文本/HTML 粘贴零变化；
- 图片 + 文本混合粘贴：只处理图片，文本由浏览器默认处理（记录为已知限制）；
- 落盘路径是本地绝对路径（`file://` 形式的 markdown 目标由 `formatRemoteUri` 生成），远端 Tab 发送时该路径在 agent 侧不存在 → **限制**：远端块不启用图片粘贴（按 `connection !== ""` 判断），给内联提示"远端暂不支持"。

---

## 8. 跨需求接口契约（防互相踩）

| 契约 | 定义方 | 消费方 |
|---|---|---|
| `SessionMessageSquares` props | 新组件 | 列表 `MessageSquares`、`BoardCard` |
| `OverviewBoardCard.recentMessages/messagesOverflow` | `overview-board-model.ts` | `BoardCard`、timeline（不消费） |
| `CardSendPhase` 新值 `unknown` | `overview-card-send.ts` | chip、徽章、`CardSendPanel` |
| `CardSendContext` 新字段 `dispatchByBlock` / `markDispatching` / `sentUnknownByBlock` | `overview-card-send-panel.tsx` | `SendStatusChip`、`submitAddAgent` |
| `writePasteImage(blob, { subdir })` | `commontext-paste-image.ts`（**向后兼容**） | CommonText（不变）、overview send |
| `overview-input-memory.ts` 纯函数 | 新模块 | `useCardSendState`、`overview-add-agent-modal` |

**顺序纪律**：`overview-card-send.ts`（phase/映射）→ chip → 卡片/行挂载 → 其余。任何人先改 UI 再改纯函数都会返工。

---

## 9. 兼容性与回滚

- R1/R2/R6/R7 全在前端，无 Go 改动 → 整体 `git revert` 即可；
- R8 只改前端超时与映射（无服务端改动）→ 回滚无副作用；
- R9 需给 `writePasteImage` 加**可选参数**（默认不变），故即使 UI 回滚，函数层也无风险；
- 唯一"不可无损回滚"的是 localStorage 数据（草稿/prefs）：键名前缀 `sessionoverview:`，回滚后残留但不影响旧代码（旧代码不读）。
