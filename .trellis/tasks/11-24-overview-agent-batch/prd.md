# PRD：Overview agent 卡融合与发送链路批次（9 需求总纲）

> 建立时间：2026-11-24（下班前落盘，供当晚夜班开发使用）
> 父任务：`11-24-overview-agent-batch`
> 子任务：
> - `11-24-agentsend-false-fail`（P1，发送假失败）
> - `11-24-agentsend-status`（P2，发送状态常驻）
> - `11-24-overview-agent-card-fuse`（P2，会话方块融合 + 去恢复 icon）
> - `11-24-overview-input-memory`（P2，输入记忆 + 存 CommonText）
> - `11-24-agentsend-image-paste`（P3，图片粘贴）
>
> 读完本文再读 `design.md`（怎么实现）与 `implement.md`（按什么顺序做、怎么验）。

---

## Goal

把用户 2026-11-24 分四轮提出的 9 条反馈，冻结成可执行、无歧义的一套需求与选型，供当晚夜班直接开发，避免信息错位导致实现偏差。

本批次**只解决 Overview agent 卡的呈现与发送链路**（看板卡与列表融合、发送状态可见、发送假失败、输入记忆、图片粘贴），不含架构级组件合并。

## 0. 来源：用户原始反馈（不得改写语义）

用户 2026-11-24 分四轮反馈，原文：

1. 「over agent card和 列表没有实现融合，比如 agent card 没有显示 列表中那种会话方块。另外agent card上无须显示恢复icon」
2. 「补充，overview 上在Tab列选择新建agent、或者发送给agent的内容，希望支持默认存储下来 ，避免再次新建或者打开就小时了，另外还需要支持用户手动操作选择存储到commonText ，ui上的表现应该是增加一个icon；另外overview agent 上应当显示 agent信息的发送状态」
3. 「292/aaaa 似乎是overview看板发送信息带来的Bug 我没有发送过这个内容」
4. 「发现发送成功了 但是还显示发送失败 ；且发送信息的编辑框无法粘贴图片？」

**术语对齐**（避免开发期歧义）：

| 用户说法 | 代码实体 | 文件 |
|---|---|---|
| over agent card / agent card | Overview **看板视图**的 agent 卡 | `frontend/app/session-overview/overview-board.tsx`（`BoardCard`） |
| 列表 | Overview **列表视图**的行 | `frontend/app/session-overview/session-overview.tsx`（`BlockRow`） |
| 那种会话方块 | 消息小方块条 `MessageSquares` | `session-overview.tsx:1257` |
| 恢复icon | 卡片右上动作区的 `arrow-rotate-right` 按钮 | `overview-board.tsx:419`（`data-board-restore`） |
| 编辑框 | 卡片 composer 浮层 / 列表行内 composer | `overview-card-send-panel.tsx`（`CardSendPanel`） |

---

## 1. 「292/aaaa」取证结论（先读，避免误判为玄学 Bug）

已在本机取证，**事实链闭合**：

| 事实 | 证据 |
|---|---|
| 落在哪个会话 | pi 会话 `7df5a37d-6f79-46aa-b625-e25490590a3c`，即 2026-11-24 07:10:25 由 Overview 新建 agent 建出的那个块 |
| 落点位置 | `ai_session_messages` 中 `seq=2`，`role=user`，`text="292/aaaa"`，timestamp `1795504235965` |
| 与用户长消息的先后 | `292/aaaa` 内层 ts `1795504235447`，用户第一条长消息 `1795504235861` → **早 414ms** |
| 是否自动发送 | 否。看板 composer **只有两条显式触发**：Enter（`onKeyDown`）与发送按钮（`onClick`）；无任何自动提交路径 |
| 最可能来源 | 「＋ 新建 Agent」弹窗的**发送内容**框（`overview-add-agent-modal.tsx` 的 `message`），提交后走 `AgentSendCommand({async:true, requester:"desktop"})` 后台派发：agent 未就绪时排队，就绪后注入并补回车。整个过程 **UI 完全不可见**（`session-overview.tsx:3079`） |

**结论**：这不是"凭空发出的消息"，而是**异步派发不可见**导致用户无法把「我填过一段草稿」和「会话里出现这条 user 消息」建立联系。它直接推出了需求 R6（发送状态常驻）与 R7（异步派发可追溯）。

> ⚠ 待用户最终确认（本轮未回）：该文本是在「新建 agent 弹窗的发送内容框」还是「看板卡 composer 浮层」里输入的。两者修法侧重不同（前者=异步不可见；后者=Enter 即发送无可逆确认）。**开发时两者都要覆盖**，不依赖该确认。

---

## 2. 需求清单（R1–R9）

每条给「现状锚点 → 目标行为」。**现状锚点是开发前必读的事实，不要凭印象改**。

### R1 看板 agent 卡显示列表同款「会话方块」

- **现状**：`BoardCard` body 只有一行文字预览 `card.preview`（`overview-board.tsx:629`）。数据侧 `boardCards` useMemo 里已经算出 `messages = readableMessages(details[sessionId]?.detail)`，但只取了最后一条做 preview（`session-overview.tsx:2937-2940`）。列表行的方块条 `MessageSquares`（`session-overview.tsx:1257-1323`）渲染 `.session-overview-message-square`，user/ai 两种底色、hover 显示 `messagePreview`、点击打开该消息、超出部分显示 `+n`。
- **目标**：看板 agent 卡显示同款方块条（同一种视觉、同一套点击语义），与列表**共享同一份渲染实现**（抽组件，不复制 JSX）。
- **约束**：
  - 方块条只在 `isAgentLike && sessionId !== ""` 时渲染；
  - 卡片高度不因消息数变化而跳动（固定上限 + `+n` 溢出）；
  - 点击方块 = 打开该消息（复用列表 `onOpenMessage` 语义），不得冒泡成"开卡片弹窗"；
  - 卡片必须继续保持 `memo` 有效（数据变化才重渲）。

### R2 移除看板 agent 卡的「恢复」icon

- **现状**：卡片右上动作区有恢复按钮（`overview-board.tsx:419`，`arrow-rotate-right`），配套：`onResumeCard` prop（:162/:240/:260）、`BoardCardResumeOutcome` 类型（:181）、`runRestore`/`restoring`/`restoreError` 状态、内联报错块（`data-board-restore-error`，:485）、上层接线 `handleResumeBoardCard`（`session-overview.tsx:2821`、传给看板 :3356）、能力位 `canRestore`（`overview-board-card-actions.ts:22`）。
- **目标**：看板卡**不再显示恢复按钮**，连同其失败内联提示、状态、能力位、上层接线一并移除（不留死代码）。
- **不做**：不删除 `AgentResumeCommand` RPC 本身；AISessions 视图的「恢复到终端」（`aisessions.tsx:1638 restoreSession`）保持不动 —— 该能力在会话面仍有入口。
- **边界**：`overview-board-card-actions.ts` 的 `canRestore` 若确认全仓仅看板卡使用，则一并删除并把测试改为"不再提供恢复能力"。

### R3 新建 agent 弹窗记住上次选择（默认存储）

- **现状**：`overview-add-agent-modal.tsx` 的 `profileName` 初始 `null` → `selectedProfile = profileOptions[0]`（永远选列表第一个）；`selectedPath` 初始 `null` → 永远「随 Tab」；`message` 初始 `""`，关掉弹窗即丢（`:89`）。
- **目标**：
  1. 记住**上次选中的 agent 类型**，下次打开默认选中它（若该 profile 本次未被探测到，回落第一项，不报错）；
  2. 记住**上次未提交的发送内容草稿**，下次打开还在（发送/建块成功后清空）；
  3. 路径仍默认「随 Tab」（决策 D1，见 §3）。
- **约束**：不新增 Go 侧 settings 字段（用前端 localStorage，与 `displayLimit`/`viewMode` 同族）。

### R4 卡片 composer 草稿持久化

- **现状**：`useCardSendState` 的 `draftByBlock` 是 `useState`，纯内存（`overview-card-send-panel.tsx:79`）。收起展开体 / 切视图 / 重开面板即丢；发送成功才清（`:124`）。
- **目标**：按 `blockId` 持久化草稿，重开面板、切列表⇄看板、重启应用后草稿仍在；发送成功后清除该块草稿；失败时保留（现有语义不变）。
- **约束**：键盘输入不得同步写 storage（防抖 + 上限裁剪）；不得整库膨胀（LRU 上限 + 过期清理）。

### R5 composer 增加「存到 CommonText」icon

- **现状**：composer footer 只有 [发送后等回复] 勾选、状态徽章、[发送] 按钮（`overview-card-send-panel.tsx:365-425`）。CommonText 侧已有完整能力：`upsertCommonTextItem(draft)`（`commontext-model.ts:717`，含重复检测抛错）、`addSelectionToCommonText(text)`（`:753`）。
- **目标**：footer 增加一个 icon 按钮，点击把**当前草稿**存为一条 CommonText 条目（不发送、不清草稿）。
- **约束**：
  - 草稿为空时按钮 disabled；
  - 内容重复时**内联提示"已存在"**，不弹窗、不抛红错；
  - 成功给一次轻量反馈（内联文案），不抢焦点；
  - 存的是纯文本草稿（不含 markdown 图片转存，见 R9 边界）。

### R6 agent 卡常驻显示「发送状态」

- **现状**：发送行程 `sendByBlock` / `sendingStartedAt` 只在**展开的 composer 内**渲染徽章（`overview-card-send-panel.tsx:385-405`）。卡片折叠时、列表行上**看不到任何发送状态**。
- **目标**：看板卡 + 列表 agent 行**常驻**显示发送状态（发送中 Ns / 已提交 / 未确认提交 / 收到回复 / 等回复超时 / 结果未知 / 失败），数据源就是 `CardSendContext`，文案与配色只从 `CardSendPhaseLabelKey` / `CardSendPhaseTone`（`overview-card-send.ts:186-202`）取。
- **约束**：不新增轮询；状态过期（例如成功 3s 后）自动淡出，不长期占位；点击状态 chip 可重开该卡 composer。

### R7 异步派发可追溯（新建 agent 首发消息）

- **现状**：新建 agent 首发消息走 `async:true`（`session-overview.tsx:3076-3088`），只 `console.warn` 失败。服务端回执能力**已存在**：`AgentDispatchListCommand` / `AgentDispatchGetCommand`（`frontend/app/store/wshclientapi.ts:58,64`；Go `pkg/wshrpc/wshserver/agentdispatch_rpc.go:122,126`），记录含 `state`(pending/delivering/confirmed/failed)、三段回执时间 `acceptedat/submittedat/confirmedat`、`submitretries`、`error`（`pkg/agentdispatch/agentdispatch.go:36-55`）。
- **关键约束（开发必读）**：`pkg/agentdispatch` 的 Store 是**纯内存**（`records map[string]*Record`），**进程重启即丢**。窗口重启后无法追溯历史派发。
- **目标**：
  1. 新建 agent 首发消息后，卡片立即出现「排队中」状态，并随回执推进到「已投递/已确认/失败」；
  2. 卡片可查该块的派发记录（至少最近 1 条）；
  3. 决策 D4：v1 只做**应用存活期内**的可见性（不落盘）；落盘另开包（避免本批次膨胀）。

### R8 修复「发送成功了却显示发送失败」（最高优先级）

- **根因（已定，勿再猜）**：客户端 RPC 超时预算 < 服务端最坏预算。
  - 客户端：`cardSendRpcTimeoutMs()` = `min(320000, waitMs + 20000)`，默认 `waitMs=60000` → **80s**（`overview-card-send.ts:58-64`）；
  - 非等回复路径：硬编码 **60s**（`overview-card-send-panel.tsx:118`）；
  - 服务端最坏：`WaitMs 30s`（`DefaultSendWaitMs`）+ `SubmitWaitMs 180s`（`DefaultSubmitWaitMs`）+ `ReplyWaitMs 60s` = **约 270s**；
  - 客户端先超时 → reject `Error("EC-TIME: timeout waiting for response")`（来源 `frontend/app/store/wshrpcutil-base.ts:28`，无 `E_XXX` 码）→ `outcomeFromSend(null, error)` 无条件映射成 `phase:"failed"`（`overview-card-send.ts:110-120`）→ UI 红字「发送失败」+ [重试]，**草稿保留**（`:123`，因 phase === "failed" 不清稿）→ 用户点重试 = **重复投递**。
- **目标**：
  1. 客户端超时覆盖服务端全预算（含提交确认 180s）；
  2. 超时/取消这类「**已注入但结果未知**」不再叫"发送失败"，改用独立语义（结果未知），并**不提供盲目重试**（防重复投递）；
  3. 只有注入前失败（`E_BLOCK_NOT_READY` 等明确错误）才显示"发送失败 + 重试"；
  4. 引入 `unknown` 行程态：可 [查状态]（读派发回执 / 刷新会话）或 [继续等]。
- **验收底线**：真机复现"agent 慢回合（>80s）"场景，不得再出现红色"发送失败"，且不得重复投递。

### R9 composer 支持粘贴图片

- **现状**：`CardSendPanel` 的 `<textarea>` 只有 `onChange` / `onKeyDown`，**无 `onPaste`**（`overview-card-send-panel.tsx:338-361`）→ 粘贴图片无反应。CommonText 侧已有完整链路：`pickPastedImages` / `validatePasteImage` / `writePasteImage`（落盘到 electron data dir 子目录，走 `FileMkdirCommand`+`FileWriteCommand`）/ `buildPasteImageMarkdown` / `spliceTextAtRange` / `materializePastedImages`（`commontext-paste-image.ts`）。
- **目标**：在 composer 粘贴剪贴板图片 → 落盘为真实文件 → 在光标处插入 markdown 图片引用 → 随文本一起发给 agent。
- **约束**:
  - 单图上限 10MB（沿用 `PASTE_IMAGE_MAX_BYTES`），超限内联提示；
  - 多图串行落盘、保序；
  - 纯文本粘贴行为零变化；
  - 落盘失败不留半截引用（沿用现有语义）；
  - 附件目录与 CommonText 分开（决策 D3），不回写 CommonText。

---

## 3. 决策记录（D1–D6）

| 编号 | 决策 | 结论 | 来源 |
|---|---|---|---|
| D1 | R3 记住什么 | **只记 agent 类型 + 未提交草稿**；路径仍默认「随 Tab」 | agent 建议，用户未否决（2026-11-24 默认采纳） |
| D2 | R4 草稿存哪 | **localStorage**（按 blockId + 防抖 + LRU 上限），不用 settings | agent 建议，用户未否决 |
| D3 | R9 图片落哪个目录 | 新建 `overview-send-images` 子目录，不复用 `commontext-images` | agent 建议（语义隔离） |
| D4 | R7 派发记录是否落盘 | v1 **不落盘**（仅应用存活期），落盘另开包 | agent 建议（控批次范围） |
| D5 | R8 超时语义 | 新增 `unknown` 行程态；**禁止**在 unknown 上自动/一键重试 | 由取证推出，强约束 |
| D6 | R2 恢复能力 | 只移除**看板卡入口**；RPC 与 AISessions「恢复到终端」保留 | 用户原话"agent card 上无须显示恢复 icon" |

> 任何开发期与上表冲突的想法，先改本文档再改代码，不要直接动手。

---

## 4. 非目标（Non-goals）

- 不做「列表卡与看板卡合并成单一 `SessionCard` 组件」的整体重构（那是独立包 `11-23-session-card-unify`，本批次只做**能力对齐**）。
- 不改 `AgentSendCommand` 的服务端等待预算常量（R8 只调客户端 + 语义映射）；若实测仍需改服务端，另开包并留判据。
- 不做手机端 / CLI 的对应 UI（R7 只保证桌面可见性）。
- 不做图片在 agent 侧的解析渲染（交给 agent 自身读文件）。
- 不改 CommonText 的同步语义（R5 只复用现有 upsert）。

---

## 5. 验收判据总表（合并验收）

每个子任务有自己的细判据，父任务只在全绿后验收：

| # | 判据 | 期望 |
|---|---|---|
| A1 | `npx vitest run frontend/app/session-overview/overview-board.test.ts frontend/app/session-overview/overview-card-send.test.ts && echo BATCH_CORE_OK` | `BATCH_CORE_OK` |
| A2 | 看板卡不再渲染恢复按钮（DOM 无 `[data-board-restore]`） | 0 个 |
| A3 | 看板卡渲染 `[data-board-message-square]`，数量 > 0 | > 0 |
| A4 | unknown 态不渲染重试按钮 | 0 个 |
| A5 | `npx vitest run frontend/app/commontext/commontext-paste-image.test.ts && echo PASTE_OK` | `PASTE_OK` |
| A6 | `node scripts/i18n/check-parity.mjs && echo I18N_OK` | `I18N_OK` |
| A7 | `npx eslint frontend/app/session-overview frontend/app/commontext && echo ESLINT_OK` | `ESLINT_OK` |

---

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| R1 卡片加方块 → 卡片变高、看板列变长 | 固定上限（默认 10）+ `+n`；卡高与消息数解耦 |
| R1 数据进 model → `memo` 失效/重渲放大 | `recentMessages` 随 `boardCards` useMemo 生成；单卡 detail 变化才重渲 |
| R4 每键写 storage → 主线程卡顿 | 300–500ms 防抖 + 单条裁剪 + 总量上限 |
| R8 放宽超时 → UI 长时间"发送中" | 状态 chip 常驻（R6）+ 秒数递增，用户随时可见；不静默 |
| R8 误判 | 保留 `E_XXX` 真错误路径；unknown 只用于 `EC-TIME`/取消类 |
| R9 粘贴大图卡主线程 | 沿用 10MB 上限 + 串行落盘 |
| 全批次 | 每个子任务独立 commit，可单独 revert；R8 优先，R1/R2 次之 |

---

## 7. 开发启动检查单（夜班接手第一件事）

1. 读本文 §0–§3，确认术语与决策，不要自行改写。
2. 读 `design.md` 得到实现方案，`implement.md` 得到顺序与命令。
3. `node E:/primary/projects/loop/bin/loop.mjs queue list --root .` 看已建工单；按 `implement.md` 阶段推进。
4. **先做 R8**（线上可见的错，且改动面最小）。
5. 有歧义**先问**（`node ... queue note` 或直接留问题到本文件 §8），不要按猜测实现。

## 8. 未决问题（开发中若遇到从这里取答案）

| # | 问题 | 状态 |
|---|---|---|
| Q1 | `292/aaaa` 究竟在"新建 agent 弹窗"还是"卡片 composer"里输入的 | 待用户确认；两种路径都需覆盖 |
| Q2 | R6 状态 chip 是否也在 AISessions 列表显示 | 默认只做 Overview 两视图 |
| Q3 | R8 服务端 `SubmitWaitMs=180s` 是否偏长（可缩到 60s） | 需真机数据后再议，本批次不动 |
