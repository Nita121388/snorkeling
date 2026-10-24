# Copy Context 构建器与 Session Detail 💡 入口

## Goal

把「Copy Context」从只服务文件型渲染面扩展到 AI 会话详情，并保持对既有 `data-copy-context-path` 路径零回归。

本任务是父任务 `10-24-aisessions-agent-copy-context` 的**地基**：它定义 DOM 标注契约与格式化纯函数，子任务 `10-24-agent-tui-selection-copy-context` 与 `10-24-aisessions-quote-to-composer` 直接复用这两个产物。

## 前置事实（已核查）

- `frontend/app/element/selection-copy-overlay.tsx:47` `getCopyContextTextFromDom(selection, target?)`：从选区起点的最近祖先找 `[data-copy-context-path]`，再从起点找 `[data-source-line]`，两者齐备才返回 `buildCopyContextText(path, line, text)`。
- 调用点仅两处且**都不带 `target`**：
  - `frontend/app/app.tsx:121`（右键菜单）
  - `frontend/app/element/clipboard-float-actions.tsx:164`（💡 浮层，`clipPos.contextText`）
- 两处随后都把结果交给 `makeCopyContextMenuItem(text, onCopied?)`，它会 `navigator.clipboard.writeText(text)` 并回调 `onCopied`。
- `makeSelectionQuickActionMenu(text, {copyMenuItems, extraMenuItems, ...})`：`copyMenuItems` 插在 `Copy` 之后、`Search In Files` 之前；`extraMenuItems` 追加在末尾。父任务的约束是固定项顺序不变。
- `MessageCard`（`session-message.tsx:310`）已有 `CopyIconButton text={message.text}`，纯文本语义，见 `session-message.tsx:378`（user 分支）与 `:405`（assistant 分支）。
- 时间线虚拟化：`session-detail.tsx:981` `shouldVirtualize(renderItems.length)`，渲染窗口来自 `virtualizer.getVirtualItems()`（`session-detail.tsx:1391`），`measureElement` 回收离屏行。
- 消息模型 `Message`（`frontend/types/gotypes.d.ts:1732`）：`seq`、`role`、`text`、`model?`、`timestamp?`、`toolName?`、`thinking?`。
- `SessionSummary`（`gotypes.d.ts:2320`）：`key`、`id`、`source`、`title?`、`projectPath?`、`timestamp` 字段名是 `createdAt` / `updatedAt`。

## 设计

### D1 新契约

新增两个 DOM 属性（常量集中在纯函数模块导出，避免各处写字面量）：

- `data-copy-context-kind="aisession"`
- `data-copy-context-meta='{"sessionId":"...","source":"claude","title":"...","projectPath":"E:\\...","seq":42}'`

挂在 `MessageCard` 的**最外层容器**上（`session-message.tsx` 中 `ref={registerRef}` 那个 div）。`meta` 里只放**消息级**信息，`sessionId` 用于后续定位。工具卡同样挂（`kind` 仍为 `aisession`，meta 增加 `toolName` / `exitCode`）。

`getCopyContextTextFromDom` 的新优先级：

1. 起点祖先命中 `[data-copy-context-kind]` → 解析 meta JSON → 交给 `formatSessionContext()`
2. 否则走原 `data-copy-context-path` + `data-source-line` 分支（原样保留）
3. 否则 `null`

**不改 `getCopyContextTextFromDom` 的函数签名与返回值语义**（仍返回 `string | null`），调用点零改动。

### D2 格式化器

新文件 `frontend/app/view/aisessions/copy-context.ts`：

```ts
export type CopyContextKind = "aisession" | "agentterm";

export type SessionCopyMeta = {
    sessionId: string;
    source?: string;
    title?: string;
    projectPath?: string;
    model?: string;
    seq?: number;
    role?: string;
    timestamp?: number;     // 毫秒
    toolName?: string;
    exitCode?: number;
};

export type SessionCopySource = {
    summary: { id: string; source?: string; title?: string; projectPath?: string };
    messages: readonly Message[];   // 已按 seq 升序的全量/窗口消息
    toolCalls?: readonly ToolCall[];
    seqStart: number;               // 选区起始 seq
    seqEnd: number;                 // 选区结束 seq
};

export function formatSessionContext(src: SessionCopySource): string;
```

要点：

- 字段收集顺序固定为 R2 规定顺序；`model` / `projectPath` / `role` / `time` / `tool` / `tool-exit` 各自独立判空，缺则整行不输出。
- `message-seq` 单值为 `42`，跨值为 `42-47`。
- 正文：覆盖 1 条 → 取调用方传入的选区文本；覆盖多条 → 从 `src.messages` 里按 `[seqStart, seqEnd]` 切片，每条前置 `**<role>:**` + 空行。
- 截断阈值 `8000` 字符，导出常量 `CopyContextMaxChars`。
- `title` 为空串时 fallback `sessionId`。
- 时间格式化复用 `formatDateTimeToSecond`（`utils.ts`），保证与 meta 行显示一致。
- 值转义：换行 → 单个空格；首尾 trim。

围栏升级单独一个导出函数，子任务 2 复用：

```ts
export function fencedBlock(text: string, language = ""): string;
```

内部计算文本内最长连续反引号 `n`，用 `max(3, n + 1)` 个反引号。

### D3 DOM 接线

`MessageCard` 增加 prop：

```ts
contextMeta?: SessionCopyMeta;   // 缺省则不挂 data-* 属性
```

容器 div 上：

```tsx
{...(contextMeta != null ? { "data-copy-context-kind": "aisession", "data-copy-context-meta": JSON.stringify(contextMeta) } : {})}
```

`session-detail.tsx` 的 `renderTimelineItem` 里为每个 MessageCard 传入 `contextMeta`，来源是 `detail.summary` + `message`。

**虚拟滚动问题（R4）**：DOM 属性只描述单条消息，拿不到跨屏范围。解决办法是 session-detail 侧维护一个 ref：

```ts
const copySelectionRangeRef = useRef<{ start: number; end: number } | null>(null);
```

- 时间线容器 `onSelectionStart`（`pointerdown` 时置 null）
- 每条消息容器 `onMouseEnter` / 触摸等价事件里，若 `copySelectionRangeRef.current == null` 则写入该消息 seq，否则更新 `end`
- 💡 的 Copy Context 需要完整范围时**读这个 ref**，而不是读 DOM

这个 ref 同时也喂给 `formatSessionContext` 的 `seqStart` / `seqEnd`。由于最终正文从 `renderItems` 对应的 model 数组取，不依赖离屏 DOM，跨屏天然安全。

**注意**：`getCopyContextTextFromDom` 只拿到选区起点的 meta（单条消息），完整范围由 ref 补。为此 DOM 契约里**不塞**范围信息，`formatSessionContext` 的输入由调用方组装。

### D4 💡 注入方式

`getCopyContextTextFromDom` 返回 null 的场合（例如 AI 面板、Note 编辑）保持原状。要让 Copy Context **出现在 Session Detail**，靠的是 D1 的属性已存在 → 既有调用链自动生效，**不需要给 Session Detail 挂额外的 `SelectionCopyOverlay`**。

但 `makeCopyContextMenuItem` 只做写剪贴板，`Quote to Input`（R3.2）属于子任务 3，届时通过 `extraMenuItems` 注入（注意那需要挂在宿主上的 overlay 才能拿到 `extraMenuItems`，这一步的可行性在子任务 3 验证；若不可行则降级为在 Session Detail 里自建一个轻量选区浮层，复用同一格式化器）。

### D5 hover 复制增强（R3.3）

`MessageCard` 的 meta 行在两个分支各加一个按钮：

```tsx
<CopyIconButton text={message.text} label="Copy message" size="xs" />
<CopyIconButton text={formatSessionContext(...)} label="Copy as context" size="xs" />
```

`formatSessionContext` 的单消息输入直接由 `message` + 父级传入的 summary 派生，所以 `MessageCard` 需要 `summary` 级信息。为不破坏 `memo` 比较函数（`session-message.tsx:415`），新 prop 用 `contextSummary` 命名并在比较函数里加入引用比较。

## 文件改动清单

| 文件 | 改动 |
|---|---|
| `frontend/app/view/aisessions/copy-context.ts` | 新增：常量、类型、`formatSessionContext`、`fencedBlock` |
| `frontend/app/view/aisessions/copy-context.test.ts` | 新增：单测覆盖 R2 / D2 全部规则 |
| `frontend/app/element/selection-copy-overlay.tsx` | `getCopyContextTextFromDom` 增分支；导出新契约常量 |
| `frontend/app/view/aisessions/session-message.tsx` | `MessageCard` 增 `contextMeta` / `contextSummary`；容器挂属性；meta 行加按钮；memo 比较更新 |
| `frontend/app/view/aisessions/session-detail.tsx` | 传入 `contextMeta` / `contextSummary`；维护 `copySelectionRangeRef` |
| `frontend/app/view/aisessions/subagent-card.tsx` | 若复用 `MessageCard`，同样传 context meta |

## 测试

`copy-context.test.ts` 必测：

1. 单消息全字段 → 输出顺序与格式逐行匹配
2. 单消息缺 `model` / `projectPath` / `timestamp` → 对应行不出现
3. `title` 空串 → fallback `sessionId`
4. 跨 3 条消息（user + assistant 混合）→ `message-seq: a-b`，无 `role` 行，正文按序带标签
5. 跨消息且角色相同 → `role` 行输出该角色
6. 正文恰好在 8000 边界 → 不截断
7. 正文 8001 → 截断 + `… (truncated, N chars omitted)`，N 正确
8. `fencedBlock` 文本含 3 个连续反引号 → 升级为 4
9. `fencedBlock` 文本含 5 个连续反引号 → 升级为 6
10. `fencedBlock` 带 language → 输出 ```` ```ts ```` 形式
11. 字段值含换行 → 折叠为空格

集成验证（手动 + 单测）：

- >60 条消息会话里跨屏拖选 → Copy Context 范围完整
- preview markdown 选区 → Copy Context 行为与改动前一致（旧分支单测必须仍绿）

## 不在本任务范围

- 终端侧格式化（子任务 2）
- Quote to Input 事件总线与 composer 插入（子任务 3）

## 实施记录

### 落地形态与计划的差异

1. **契约拆成两层文件**：计划里把 DOM 契约常量放在 `selection-copy-overlay.tsx`，实际拆到新文件 `frontend/app/element/copy-context-contract.ts`。原因：`app/element` 不应反向 import `app/view/aisessions`，否则分层倒挂。契约（属性名 + 类型 + resolver 注册表）在 element 层，格式化（`formatSessionContext` 等）在 view 层。
2. **跨屏范围不靠 DOM 属性**：计划里 D3 想让 DOM 属性带范围，实际改为「消息容器只带自己的 seq + 一个模块级 resolver 注册表」，范围由 `session-detail` 在 `pointermove` 期间持续记录并读 model 重建。属性更小，且不受虚拟化卸载影响。
3. **工具卡也挂契约**：`ToolCallCard` 外层包一层带 `data-copy-context-*` 的 div（带 `toolName` / `exitCode`，**不带** `data-aisession-seq`，避免工具 seq 污染消息区间）。

### 元数据增强（用户第二轮要求）

首版字段只有 session / id / source / model / project / seq / role / time。用户要求「再详细些，便于 agent 更快定位」，补上：

`session-file`（磁盘 JSONL，最强定位）、`created` / `updated`、`parent-session`、`messages-referenced`、`session-messages`、`entry-id` / `item-key`、`time-end`；终端侧补 `lines`。

**删掉的**：`session-key` —— 实测真实输出里它是 `pi:<id>:<filePath>`，与 `session-file` 完全重复且更长，属于纯噪音。

### 真实 app 验证（CDP + 剪贴板回读）

在 dev 应用里点消息 hover 的「Copy as context」，从剪贴板读回的实际输出：

```
<context>
session: 这个会话所说的 14次异常关机 是否也可能包含用户直接关闭电源的场景？
session-id: 328568ab-fae7-413e-a00b-606ea6bf7836
source: pi
project: D:\Code\LiCASmart
session-file: C:\Users\chemclin\.pi\agent\sessions\--D--Code-LiCASmart--\2026-10-24T05-48-59-655Z_328568ab-....jsonl
created: 2026-10-24 13:48:59
updated: 2026-10-24 16:28:58
message-seq: 143
messages-referenced: 1
session-messages: 17
role: assistant
time: 2026-10-24 16:23:57
</context>
```

同时确认 DOM 上 `data-copy-context-kind` / `-meta` / `data-aisession-seq` 均已正确挂载。

### 测试

- `copy-context.test.ts` — 39 项：格式、截断、围栏、定位字段顺序、resolver 注册表
- `copy-context.dom.test.tsx` — 7 项（jsdom）：契约解析、坏 meta、未知 kind、**旧 file/line 分支零回归**、💡 与 hover 两入口逐字节相等
- `npx tsc --noEmit` 对改动文件零错误；`eslint` 零 error（余下 warning 均 pre-existing）
- 全量 `vitest run`：1798 passed / 21 failed，失败项全部为 pre-existing（已用 stash 对照验证：`preview-directory-utils`、`blockregistry`、`scripts/*` 等与本次改动无关）


## Acceptance

- [ ] `copy-context.test.ts` 11 组用例全绿
- [ ] `frontend/app/element/` 下与 `getCopyContextTextFromDom` 相关的既有单测全绿（未改动旧分支语义）
- [ ] Session Detail 选中文字后 💡 菜单出现 `Copy Context`，粘贴结果符合 R2 格式
- [ ] `MessageCard` hover 出现「Copy as context」按钮，输出与 💡 入口逐字节一致
- [ ] ≤60 行会话的渲染与交互无变化
- [ ] >60 行会话跨屏拖选输出完整消息范围
- [ ] `npm run lint` / `tsc` 通过（按项目既有命令）
