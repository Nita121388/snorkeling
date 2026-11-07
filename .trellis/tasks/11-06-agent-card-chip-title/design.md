# 技术设计：chip 收口 + 运行时长 + 标题编辑

## 1. 分层：一个纯函数，一个组件，四个面

```
agent-status-chip-view.ts        ← 纯函数：唯一文案/类名/跑时/工具产出地（React 无关）
        ↑                    ↑
AgentStatusChip (React)   term-model HeaderElem（viewText atom）
        ↑
4 个调用面：list / board / card / aggregate
```

### 1.1 `agent-status-chip-view.ts`（新增，`frontend/app/agent-status/`）

```ts
export type AgentStatusChipVariant = "list" | "board" | "card" | "header" | "aggregate";

export type AgentStatusChipView = {
    /** 主文案：状态词（Working / Done / Tool: Bash …），aggregate 变体是聚合词 */
    label: string;
    /** 运行时长文本，空串 = 不显示（见 §2） */
    runtime: string;
    /** 供 UI 选色的语义（= AgentStatusTone） */
    tone: AgentDisplayState;
    /** 完整 tooltip（含 inferred / 已读语义） */
    title: string;
    /** 是否 ackable */
    ackable: boolean;
    /** chip 根元素的 class（含 variant 类与既有兼容类） */
    className: string;
};

export function buildAgentStatusChipView(input: {
    variant: AgentStatusChipVariant;
    status?: AgentStatus | null;
    aggregate?: AgentStatusAggregate | null;
    read: AgentReadState;
    nowMs: number;
}): AgentStatusChipView | null;
```

- 内部复用 `deriveAgentStatusView()`（已有的唯一 read 判定入口）与 `agentStatusPresentation()`，**不新增第二套判定**。
- `aggregate` 变体走 `aggregateAgentStatuses()` + `aggregateStatusLabel()`，`runtime` 恒为 `""`（聚合体没有单一 `activeSince`）。
- `className` 里**保留既有兼容类**，避免打破已有 verify 探针与外部样式：
  - `card` → `agent-card-status-chip is-<tone> is-unread|is-seen`
  - `header` → `agent-status-header is-<state> phase-<phase> [is-inferred] [is-acked] [is-done-unread]`
  - `list`/`board`/`aggregate` → `session-overview-agent-status|session-overview-agent-aggregate is-<tone> …`

> 兼容类是**契约**，写进单测；`scripts/verify/agent-card-seen/verify.mjs` 依赖 `.agent-card-status-chip` 与 `.agent-status-header`。

### 1.2 `AgentStatusChip`（重写 `frontend/app/session-overview/agent-status-chip.tsx`）

```tsx
export const AgentStatusChip = React.memo(function AgentStatusChip({ variant, status, aggregate, now, unread, onAck, blockId, className }) {
    const nowTick = useAgentSecondTick(/* enabled */ needsRuntime(status));
    const view = buildAgentStatusChipView({ variant, status, aggregate, read: unread ? "unread" : "seen", nowMs: Math.max(now, nowTick) });
    …
});
```

- **React.memo**：比较 `status`（引用）、`unread`、`variant`、`now`。`status` 对象由 store 只在变化时替换，因此 1s tick 只重渲染 chip 自身。
- `now` 仍保留为 prop（面板 30s tick / 测试注入），跑时取 `max(now, tick)` 保证测试可注入固定时间。
- 根元素：`list`/`board`/`card` 用 `<button>`，`header` 用纯文本（HeaderElem 不走这里），`aggregate` 保持 `role="button"` span（嵌在 tab-toggle `<button>` 内，嵌套 button 非法）。
- 结构统一：`[icon?] [dot?] <span label> [<span runtime>]`，由 variant 决定 icon/dot 是否存在。

### 1.3 `term-model.ts` 头部

`getAgentStatusHeaderElem` 改为：

```ts
const view = buildAgentStatusChipView({ variant: "header", status, read, nowMs });
if (view == null) return null;
if (view.runtime !== "") get(agentStatusSecondTickAtom);   // 只有需要跑时才订阅
return { elemtype: "text", text: `${view.label}${view.runtime ? " " + view.runtime : ""}`, className: view.className, tooltipNode: view.title, … };
```

`is-acked` / `is-done-unread` / `phase-*` 全部由 `view.className` 产出，`term-model` 不再自己拼字符串。

## 2. 运行时长

### 2.1 格式（`agent-status-runtime.ts` 新增）

带单位、不用 `mm:ss`：`00:07` 读起来像计时器而不是"跑了多久"。

```ts
export function formatAgentChipRuntime(startMs: number, nowMs: number): string
```

| 场景 | 输出 |
|---|---|
| `start <= 0` / `now - start < 0` | `""` |
| `< 60s` | `7s` |
| `< 60min` | `3min21s` |
| `< 24h` | `1h12min` |
| `>= 24h` | `2d3h` |

- 定宽数字由 CSS `font-variant-numeric: tabular-nums` 保证，不跳宽。
- 负值裁剪为 `""`（`activeSince` 可能因上游时钟/上报乱序回退，`agentstatus.go` 保留 `prevSource.ActiveSince`，理论上不回退，但客户端不假设）。

### 2.2 何时显示

`needsRuntime(status) = status != null && (state === "working" || state === "blocked" || state === "stale")`

- `done` 态沿用现有语义：只有**未读** Done 显示 elapsed（`agentStatusViewLabel` 的 `Done 3m`），格式不变（分钟级），**不**改成秒级 —— 完成态秒级跳动是噪音。
- `idle` / `unknown` 不显示。

### 2.3 tick 机制（`agent-status-second-tick.ts` 新增）

```ts
export const agentStatusSecondTickAtom = atom<number>(0);
// 单例 setInterval(1000)；document.hidden 时跳过写入；visibilitychange → 立即补一次
```

- **订阅方只有 chip 自身**（`useAgentSecondTick`），不经过面板 state。
- 无人订阅时 jotai 不会重算任何下游；timer 仍在跑（每秒一次 `if (document.hidden) return;` 判断，成本可忽略），换取"不需要管理订阅引用计数"的简单性 —— 与已有 `nowMinuteTickAtom` 同一取舍（`agent-status-done-tick.ts` 的注释已记录这个决定）。
- 测试可 `resetAgentSecondTick()` 停止 timer（沿用 `resetNowMinuteTick` 的做法）。

### 2.4 性能预算（写进实现注释）

| 项 | 成本 |
|---|---|
| 1 次 `buildAgentStatusChipView` | 纯函数，无分配热点，≈2µs |
| 可见 chip 数（Overview 一屏） | ≤ 40 |
| 40 chip × 1Hz 重渲染 | ≈ 2–4 ms/s CPU（< 0.5% 单核），且只有 chip 子树 |
| 对比：面板级 1s tick | 整树 + `boardCards`/`timelineRows` 重算 + 看板全量 rect 采样 |

结论：可以做秒级。**唯一红线**是不许把 tick 提到 `SessionOverviewPanel`。

## 3. 标题编辑

### 3.1 `EditableTitle`（`frontend/app/element/info-card/editable-title.tsx`，新增）

```tsx
type EditableTitleProps = {
    title: string;
    placeholder?: string;
    titleSource?: string;          // 渲染 TitleSourceBadge
    editable?: boolean;            // 默认 true
    enterToEdit?: "double" | "single";  // 弹窗 double，悬浮卡 single
    onCommit: (next: string) => Promise<SessionSummary | null>;
    className?: string;
    width?: "full" | "flex";
};
```

- 展示态：`<span className="info-card-title" title={title}>`（沿用 `InfoCardMarquee` 的截断语义 + `TitleSourceBadge`）
- 编辑态：`<input className={RenameTitleInputClass}>`（从 `session-detail.tsx` 抽到 `frontend/app/view/aisessions/title-edit.ts` 共享常量，避免两份视觉）
- 键：`Enter` → commit；`Escape` → `event.preventDefault() + event.stopPropagation()` 后退回展示态。
  `stopPropagation` 是必需的：`AppKeyHandlers` 在 `document` 上挂了冒泡期 keydown（`app.tsx:349`），
  不拦就会走到 `modalsModel.cancelTopModal()`（`keymodel.ts:776`）把整个弹窗关掉。
- commit 失败：保持编辑态 + 行内错误文案；空串/未变化：直接退出，不调 `onCommit`。

### 3.2 `renameTitle`（`session-note-hook.ts`）

```ts
const renameTitle = React.useCallback(async (next: string): Promise<SessionSummary | null> => {
    const nextTitle = next.trim();
    if (summary == null || sessionId === "" || nextTitle === "" || nextTitle === (summary.title ?? "")) return null;
    try {
        const updated = await service.Title(sessionId, nextTitle, connection || "");
        dispatchAISessionNoteUpdated(updated);       // 与 applyTitle 同一广播通道
        return updated;                              // 成功返回写入后的 summary，供调用面做 §3.3
    } catch (err) { setError(...); return null; }
}, [connection, service, sessionId, summary]);
```

- 返回 `SessionSummary | null`：`null` = 没写/失败，`EditableTitle` 据此决定是否退出编辑态。
- **hook 不接收 `blockId`**（现有签名 `(sessionId, connection)`，`SessionDetailInfoCard` 等调用点也没有 blockId）。
  R4 的 ack 因此放在**调用面**（`AgentHoverCard` 与 `AgentCardModal` 都持有 `blockId`），保持 hook 的通用性。
- 不做本地影子状态：标题一律以 note-cache 广播为准（与星标、note 的既有约束一致）。

### 3.3 R4 副作用隔离：改名不得点亮 Done

`SetTitle` bump `UpdatedAt` → `presentAgentStatus` 的 `idle + unseen + recent → done` 分支会误命中。

前端方案（不扩后端契约）：

```ts
// 调用面（AgentHoverCard / AgentCardModal），改名成功后立刻执行：
function ackSelfTitleEdit(blockId: string, status: AgentStatus | null) {
    // 用户自己制造的更新，等价于已看过
    ackAgentStatus(blockId, status, "title-edit");
}
```

- 落点：复用 `agent-status-ack.ts` 的 `ackAgentStatus()`（R 指纹与 D 完成态两份 map 的既有唯一写入口），
  **不新增第三份 store**。`AgentAckSource` 联合类型追加 `"title-edit"`。
- 调用时机：`renameTitle` 返回非 null 之后、且该 block 当前呈现态为 `done` 时才 ack（避免无谓写入）。
- 语义：这是"用户自己制造的更新"，不该再提示。
- 反向保护：**不改** `SetTitle` 后端行为、不改 `derive` 规则；`session-detail` 的改名入口本包不动（它没有 agent 状态面）。

### 3.4 各处接线

| 位置 | 改动 |
|---|---|
| `agentcardmodal.tsx` | `title={noteState.title}` → `<EditableTitle enterToEdit="double" onCommit={…}/>`；Escape 拦截见 §3.1，不改 `Modal` 契约 |
| `session-note-section.tsx` `variant="hover"` | `agent-card-title-block` 内换成 `<EditableTitle enterToEdit="single">`；编辑中沿用 `InfoCardPortal` 的 `cardProps` 焦点保活 |
| `session-note-section.tsx` `variant="detail"` | `InfoCardMarquee` 换成同一 `EditableTitle`（`enterToEdit="double"`），保证详情卡也一致 |

> `SessionNoteSection` 需要新增一个可选回调 `onRenameTitle?: (next: string) => Promise<SessionSummary | null>`，
> 由调用面提供（AgentHoverCard / AgentCardModal 各持有 blockId 以完成 §3.3 ack）。
> 未提供时 `EditableTitle` 自动降级为只读展示（`session-detail-info-card.tsx` 等现有调用点行为不变）。

## 4. 视觉统一

- 共享几何移到一个 scss 文件：`frontend/app/agent-status/agent-status-chip.scss`（新增），由 `agent-status-chip.tsx` import。
  - `.agent-status-chip`（base：`display:inline-flex; align-items:center; line-height:1; font-variant-numeric: tabular-nums;`）
  - `.agent-status-chip--list|--board|--card|--header|--aggregate`（各自高度/字号/圆角/边框/dot 尺寸）
- 既有类名（`.session-overview-agent-status`、`.agent-card-status-chip`）作为 variant 的**别名**保留在 class 列表里，
  旧样式规则逐步删掉；`info-card.scss` 与 `session-overview.scss` 中对应的 chip 段落迁移走，避免两份。
- **垂直居中**：base 用 `align-items: center` + `line-height: 1`，并对 label 显式 `margin-block-start: -0.5px`-级别的补偿
  由实测决定（见 implement Step 6 的 1px 判据）；不允许用 `padding-top` 猜值。

## 5. 风险与回滚

| 风险 | 处置 |
|---|---|
| `React.memo` 让 chip 漏更新（status 引用不变但 read 变了） | memo 比较器显式包含 `unread` / `now` / `variant`；read 变化经 `unread` 传入 |
| 1s tick 泄漏（组件卸载后仍在写 atom） | tick 是模块级单例，不按组件挂载管理（与 `nowMinuteTickAtom` 同构）；`document.hidden` 跳过写入 |
| 改名误触发 Done 提示 | §3.3 ack helper + 单测回归锁 |
| ESC 关掉弹窗丢草稿 | §3.1 `stopPropagation` + `agentcardmodal` 的 `closeOnBackdrop={false}` 已有；补 ESC 断言 |
| 旧类名被删导致 verify 探针失联 | §4 兼容类别名 + 单测断言 class 列表 |
| 看板/列表样式回归 | `overview-board` 台 + `agent-card-seen` 台双跑 |

回滚：三次独立 commit（chip 收口 / 跑时 / 标题编辑），任一可单独 revert；`agent-status-chip-view.ts` 为纯新增模块，回滚后旧实现不受影响。
