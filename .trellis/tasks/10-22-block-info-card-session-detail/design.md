# 技术设计：InfoCard 覆盖 SessionDetail/Chat block + note/tags 同步修复

## 1. 现状与根因（代码事实）

### 1.1 分派链

```
inline tab           → block.tsx:421            ─┐
block frame header   → blockframe-header.tsx:716 ─┤→ BlockInfoCard()
sidebar              → block-sidebar.tsx:266     ─┤      (block-info-card.tsx:108)
tab 信息卡分类        → tab-info-card.tsx:31       ─┘
```

`BlockInfoCard()` 只分派 Note / Preview / `isAgentTerminalMeta` 三种，其余 `null`。

### 1.2 为什么 SessionDetail / Chat block 拿不到卡片

- SessionDetail block meta：`{ view: "aisessions", "aisessions:sessionid": <id>, ... }`
  （`session-detail-block.ts` `makeSessionDetailBlockDef`）。
- `isAgentTerminalMeta`（`view/term/agent-meta.ts`）只读 `agent:sessionid / agent:provider /
  agent:autoresume / cmd` → aisessions block 命中不了。
- `blockframe-header.tsx:560` 额外要求 `isTerminalBlock = metaView === "term"`。

### 1.3 为什么 note/tags 不显示

- AgentHoverCard 的数据源是 `session-note-cache`，键 = `connection|sessionId`，
  `sessionId` 来自 `agentSessionIdFromBlockData()` → `resolveAgentSessionId(meta)`，
  不认 `aisessions:sessionid`。GUI Chat block 的 id 恰好在 `aisessions:sessionid`。
- 草稿 `noteDraft` 只在 `[sessionId]` 变化时从 summary 初始化，summary 异步到达时草稿仍空。
- `session-note-cache` 的 `status === "loaded"` 早退，事件是唯一刷新通道。

## 2. 影响面分析

`gitnexus` 索引当前是 **stale**（index@9021395，HEAD@eeb1292），`impact` 结果只作参考；
**实施前必须先 `gitnexus analyze`，再对下列符号重跑 `impact` 并把风险写回本文件**。

已知（旧索引）：

| 符号 | 风险 | 直接调用方 | 决策 |
|---|---|---|---|
| `isAgentTerminalMeta` | HIGH (5 direct, 1 process) | `block.tsx` ×3、`blockframe-header.tsx`、`tab-info-card.tsx` | **不改语义**。新增独立 helper，卡片层用并集判定，避免 HIGH 风险扩散 |
| `BlockInfoCard` | 未索引（新代码） | 4 个 surface | 只加分支，不改签名 |
| `agentSessionIdFromBlockData` | 未索引 | 仅 agent-hover-card 内部 | 行为放宽（先读 aisessions 键），只增不减 |

## 3. 设计

### 3.1 新增 meta 判定（新文件 `frontend/app/block/block-info-card-meta.ts`）

纯函数、无 React 依赖，便于单测；避免把 aisessions 判定塞进 `agent-meta.ts`
（那会改变 `isAgentTerminalMeta` 的高风险语义）。

```ts
// 会话类 block 的 canonical session id（aisessions 优先，再退 agent:sessionid，再 cmd 解析）
function resolveBlockSessionId(meta: Record<string, unknown> | null | undefined): string;

// 单会话详情 block：view === "aisessions" && aisessions:sessionid 非空
function isSessionDetailBlockMeta(meta): boolean;

// GUI Chat block：view === "aisessions" && (aisessions:sessionid 非空 || aisessions:newchat === true)
function isChatBlockMeta(meta): boolean;

// 需要 InfoCard 的 agent 类 block（并集，不改 isAgentTerminalMeta）
function isAgentCardMeta(meta): boolean;
```

`resolveBlockSessionId` 注意与既有 helper 保持一致：

- `aisessions:sessionid` 与 `agent:sessionid` 都先 `trim()`，空串视为缺失；
- 最后回退 `resolveAgentSessionId(meta).sessionId`（保持 TUI block 现有行为）。

### 3.2 BlockInfoCard 分派顺序

```
Note → Preview → SessionDetail → Chat → Agent(isAgentTerminalMeta) → null
```

- SessionDetail 先于 Chat：详情 block 也有 `aisessions:sessionid`，但它没有 newchat，
  且卡片内容更丰富（note/tags 全量），必须先命中。
- Chat 先于 Agent：GUI Chat block 若同时带 `agent:*`（从列表 resume 恢复时
  `utils.ts:357` 会写 `agent:sessionid`），应走会话卡片而不是 TUI 卡片。
- **实施修正**：Chat 最终也走 `SessionDetailInfoCard`（而不是 AgentHoverCard）。
  原因：GUI Chat block 没有 `agent:provider`，AgentHoverCard 只能显示 "Agent / 未指定"，
  且它要消耗 AgentStatusStore；而用户真正需要的是同一个会话的 tags/note。
  模型/状态在 composer 与 Tab 卡里已有展示，不重复。

### 3.3 SessionDetailInfoCard 数据来源

复用 `session-note-cache`（已经是「note/tags 的单一真相源」）：

```
sessionId  = resolveBlockSessionId(meta)   // aisessions:sessionid
connection = meta.connection（trim 后空串）
→ ensureSessionNote(service, sessionId, connection)
→ useSyncExternalStore(subscribeSessionNote, getSessionNoteSnapshot)
```

不直接调 `AISessionsService.Detail`，避免详情块重复拉全量消息。

组件结构（新 `frontend/app/block/session-detail-info-card.tsx`）：

```tsx
<InfoCard>
  <InfoCardSection>            // 身份
    <InfoCardHead><InfoCardIcon/><InfoCardTitle>{title}</InfoCardTitle></InfoCardHead>
    <InfoCardMeta>{source} · {messageCount} msgs</InfoCardMeta>   // 空则不渲染
  </InfoCardSection>
  <SessionNoteSection … />     // 共享 note + tags + AI 生成（抽自 AgentHoverCard）
  <InfoCardSection>            // 路径
    <InfoCardPreview onClick={onOpen}><InfoCardText>{path}</InfoCardText></InfoCardPreview>
  </InfoCardSection>
</InfoCard>
```

- summary 未就绪：渲染身份骨架（标题取 `meta["frame:title"]` 或 "Session Details"），
  note/tags 段在 summary 到达后出现，不返回 `null`。
- `onOpen` 由调用方传（inline tab 传 `onActivate`，sidebar 传 restore）。

### 3.4 抽共享 `SessionNoteSection`

从 `agent-hover-card.tsx` 的 `useSessionNote` 中拆出：

```ts
// frontend/app/store/session-note-hook.ts
function useSessionNoteState(sessionId: string, connection: string): {
    summary; noteDraft; setNoteDraft; isEditing; setIsEditing;
    saveStatus; error; inputRef; finishEditing; dirty;
    previewText; title;
};
```

关键改动（R4.1）：

1. `dirty` 状态：`setNoteDraft` 的用户入口显式置 `dirty = true`；程序化同步不置。
2. 程序化同步时机：`summary.note` 变化且 `!dirty` 且 `!isEditing` → 同步草稿；
   不再依赖 `[sessionId]` 单依赖。
3. 自动保存条件：`dirty && !saving && 草稿与 summary 不同`（与
   `shouldAutoSaveNote` 口径一致），彻底去掉「空草稿覆盖」路径。
4. 预览：未编辑时 `previewText = firstLine(summary.note) || tagsLabel(summary.tags) || "Note"`；
   编辑时用草稿。这样即使草稿同步延迟，卡片也不会显示 "Click to add a note..." 而丢掉备注。
5. `AgentHoverCard` 与 `SessionDetailInfoCard` 都消费该 hook，UI 段抽成
   `SessionNoteSection`（新 `frontend/app/element/info-card/session-note-section.tsx`）。

### 3.5 session-note-cache 刷新

```ts
const NoteRefreshTtlMs = 30_000;

export function ensureSessionNote(service, sessionId, connection, opts?: { force?: boolean })
```

- `status === "idle"` → 首次加载（现状）
- `status === "error"` → 重置 retryCount 后重拉（现状）
- `status === "loaded"` 且 `Date.now() - loadedAt > NoteRefreshTtlMs` → 后台刷新
  （保留旧快照展示，不进入 loading 闪烁）
- 在途请求（`entry.promise != null`）不重复发起
- 事件匹配归一化：

```ts
function sessionIdMatches(candidate: string, sessionId: string): boolean {
    if (candidate === sessionId) return true;
    if (candidate.endsWith(":" + sessionId)) return true;   // <source>:<id>:<path>
    if (candidate.startsWith(sessionId + ":")) return true;
    return false;
}
```

事件里同时对 `summary.key` / `summary.id` 逐个比较；`candidates` 不再只是裸集合。

### 3.6 header / tab 卡分类

- `blockframe-header.tsx`：

```ts
const isCardBlock = isTerminalBlock ? isAgentCardMeta(meta) : isAgentCardMeta(meta);
```

等价于直接 `isAgentCardMeta(meta)`（term block 已被 isAgentCardMeta 覆盖），
但渲染端口保持原 `isAgentBlock && (isHovered || isCardHovered)` 结构，只换判定函数。
**不改变 term block 的现有行为**（isAgentTerminalMeta 为真时 isAgentCardMeta 必为真）。

- `tab-info-card.tsx:classifyBlock`：新增 `chat` 分类 → `counts.chat`，渲染
  `N chat` chip；`agentBlockIds` 分离为 `chatBlockIds` + `agentBlockIds`，
  Agents 清单只列 term agent（避免 GUI chat 混进状态清单，状态源不同）。

## 4. 数据流

```
block meta
  └─ resolveBlockSessionId → sessionId / connection
       ├─ session-note-cache ──(Summary RPC)──> summary(note,tags,title,…)
       │        ▲                      │
       │   aisession-note-updated 事件 │
       │        └──── 归一化匹配 ──────┘
       └─ useSessionNoteState ──> SessionNoteSection (预览/编辑/tags)
```

## 5. 兼容与回滚

- 全部为前端增量；不改 RPC 契约、不改 sqlite。
- 回滚点：`BlockInfoCard` 的分支可单独删除（其它 surface 自动回退 null）；
  `session-note-hook` 的 `dirty` 改动若出问题，`AgentHoverCard` 可临时回退到内联实现
  （保留原文件 git 历史即可）。
- 不改 `isAgentTerminalMeta`，因此 `block.tsx` 的 3 处调用零风险。

## 6. 验证策略

1. 单测（vitest）：
   - `block-info-card-meta.test.ts`：`resolveBlockSessionId` 三种形态 / `isSessionDetailBlockMeta` / `isChatBlockMeta` / `isAgentCardMeta`
   - `block-info-card.test.tsx`：分派顺序（note > preview > session > chat > agent > null）
   - `session-note-cache.test.ts`：TTL 重拉、事件归一化、在途不重复
   - `agent-hover-card`（或 `session-note-hook.test.tsx`）：summary 晚到不触发保存、不清空
2. 手工：CDP 检查（`node scripts/inspect-electron-ui.mjs`）悬浮 Session Detail block 的
   inline tab 与 header，确认 tags/note 渲染；在全局列表改 note/tags 后悬浮 agent block 验证同步。

## 7. 实施记录（2026-10-22）

已落地：

| 文件 | 变更 |
|---|---|
| `frontend/app/block/block-info-card-meta.ts` | 新增 `resolveBlockSessionId` / `isSessionDetailBlockMeta` / `isChatBlockMeta` / `isAgentCardMeta`（纯函数） |
| `frontend/app/block/block-info-card.tsx` | 分派顺序 Note → Preview → SessionDetail → Chat → Agent → null |
| `frontend/app/block/session-detail-info-card.tsx` | 新增会话卡片（身份 + note/tags + 路径 + Open） |
| `frontend/app/store/session-note-hook.ts` | 新增共享状态 hook：`dirty`、程序化同步、预览取 `summary.note`、AI 元数据提案 |
| `frontend/app/element/info-card/session-note-section.tsx` | 新增共享 note/tags 区段（两张卡片共用） |
| `frontend/app/store/session-note-cache.ts` | `NoteRefreshTtlMs=30s` 后台刷新、`force`、事件 key 归一化匹配 |
| `frontend/app/view/term/agent-hover-card.tsx` | 改用餐 state hook + `resolveBlockSessionId`（兼容 `aisessions:sessionid`） |
| `frontend/app/block/blockframe-header.tsx` | 卡片判定换成 `isAgentCardMeta`（去掉 term-only 前置） |
| `frontend/app/tab/tab-info-card.tsx` | 新增 `chat` 分类与计数 |

测试（全部通过）：

- `frontend/app/block/block-info-card-meta.test.ts` — 17
- `frontend/app/block/block-info-card.test.tsx` — 8（分派顺序）
- `frontend/app/store/session-note-cache.test.ts` — 14（+ TTL / 归一化）
- `frontend/app/store/session-note-hook.test.tsx` — 5（晚到 summary 不写空备注等）

待办：

- `gitnexus analyze` 在本次实施中超时（1800s 上限），索引仍是旧的 → 交付前需重新跑
  并补 `detect-changes` 证据。
- CDP 手工验证未做（见 §6 第 2 条）。
