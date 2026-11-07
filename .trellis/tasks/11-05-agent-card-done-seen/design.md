# Design — Agent 卡片 Done 随 seen 状态联动

## 1. 分层边界

```
Go pkg/agentstatus (canonical)          ← 不动
        ↓ agentstatus 事件
AgentStatusStore.presentedAtom          ← 不动（presentCanonicalAgentStatus 保持 done 粘性）
        ↓ + ackedFp / doneAckedAt / seenAt
deriveAgentStatusView()  (新)           ← read 维度的唯一判定处
        ↓ AgentStatusView
A/B/C/D 现有面（保留自家降噪阈值）       ← 逐步迁移到 view，不改阈值
E/F/G 卡片面（新接入）                   ← 读 view，不再读 presentation().label
```

关键决策：**read 作为独立维度叠加**，不改 `state`。理由：`presentCanonicalAgentStatus` 被 6 个面 + 5 个测试直接依赖，改它的 done 提升会连锁；而 read 是纯增量信息，未接入的面行为不变（渐进迁移、可回滚）。

## 2. 契约

`frontend/app/agent-status/agent-status-view.ts`：

```ts
export type AgentReadState = "unread" | "seen";

export type AgentStatusView = {
    state: AgentDisplayState;
    phase: AgentPhase;
    label: string;              // "Done" | "Working" | "Thinking" | "Tool: bash" | "Idle" …
    tone: "working" | "done" | "blocked" | "error" | "rate-limited" | "stale" | "idle" | "unknown";
    read: AgentReadState;
    elapsedText: string;        // unread Done 才有值："3m" / "1h"；否则 ""
    title: string;              // tooltip：label + inferred + reason + seen 语义
    ackable: boolean;           // read==="unread" && (done 或 R 类)
    inferred: boolean;
};

export function resolveAgentSeenAt(ctx: {
    doneAckedAt?: number;
    seenAt?: number;
}): number;                     // = max(doneAckedAt, seenAt)，非有限值当 0

export function deriveAgentStatusView(input: {
    status: AgentStatus | null;
    blockId: string;
    ackedFp?: string | null;
    doneAckedAt?: number;
    seenAt?: number;
    nowMs: number;
}): AgentStatusView | null;     // status==null → null（各面渲染"无状态"）
```

实现内部**复用**既有函数，避免第二套判定：
- `agentStatusPresentation(status)` → `label` / `title` / `icon`
- `isInferredAgentStatus(status)`
- `isAgentStatusUnread(status, ackedFp)` → R 类 read
- `isAgentDoneUnread(status, resolveAgentSeenAt(...))` → D 类 read
- `agentDoneElapsedMs` + `formatDoneElapsed` → `elapsedText`

即 `read = (unread || doneUnread) ? "unread" : "seen"`，D 类把 `doneAckedAt` 替换为合并后的 `seenAt`。这样 A–D 迁移后行为完全等价（合并值 ≥ doneAckedAt，只会让 seen 更早成立）。

## 3. seen 源（实现后简化，与原设计不同）

**原设计**：新增独立 `seenAt` store，view 层 `max(doneAckedAt, seenAt)`。

**落地时改为单通道**，理由：7 个展示面里已有 4 个读 `doneAckedAtAtom`，再引入第二个 map 会逼每个面各读两份再自己合并 —— 正是本次事故的形态。对「Done 该不该点亮」而言，"点过确认"与"切过去看够 2s"是同一个结果，所以两条写入通道共用一个落点，只保留 source 区分（pslog）。
被否决的独立通道收益（"强 ack 压过弱 seen"）需要两层时间比较，而现有 `doneAckedAt` 语义本就是「看过的时刻」，无实际需求。

| 通道 | 写入点 | 落点 |
|---|---|---|
| 显式 ack | A 徽章 / B 圆点 / C 圆点下拉 / Overview chip / 卡片 pill | `doneAckedAtAtom` |
| 自动 seen | `TerminalView` 挂载后停留 ≥ 2s（只在挂载首帧已是未读 Done 时） | `doneAckedAtAtom` |

自动 seen 的边界（关键，防止把功能做废）：
- 只在**挂载后第一帧**状态判定 → 「用户正盯着跑、跑完了」不写 seen，否则 D 提示对当前正在看的 block 永远不亮。
- 停留门槛 2s → 切 tab 路过不算。
- hover 卡片不算（卡片是路过，不是看）。
- 进入非 idle 状态时由 `observeAgentStatusTransition` 清掉（复用既有 D 清理逻辑）。

仍不复用 `blockViewedAtAtom`（服务会话消息未读，语义不同）。

## 4. 写入收口

```ts
// agent-status-ack.ts
export function ackAgentStatus(blockId, status, source): void;  // fp map + doneAckedAt
export function markAgentSeen(blockId, source): void;           // doneAckedAt（"看过"通道）
export function resolveAgentDoneAckedAt(blockId): number;       // 非 React 消费面用
```

替换点：
- `view/term/term-model.ts:696-697` → `ackAgentStatus(...)`
- `block/block.tsx:637-650` → `ackAgentStatus(...)`
- `session-overview/session-overview.tsx:2135-2155`（`ackAgentStatus` / `ackTabAgentStatuses` 两个局部 callback）→ 调收口函数
- 新增：`TerminalView` 挂载（`useMarkAgentSeenOnView`）→ `markAgentSeen(...)`

保留 `source` 字段进 pslog（现有 `D:<source>` 约定不变，source 增加 `card-pill` / `session-open`）。

## 5. 视觉

| read | 头部徽章 | 卡片 pill |
|---|---|---|
| unread Done | 现有 `.is-done-unread`（绿 + 呼吸 + `Done 3m`） | 绿点 + 呼吸 + `Done 3m` |
| seen Done | 现有 `.is-acked`（灰虚线 + 0.7 opacity + `Done`） | `.is-seen`：灰点 + 无动画 + `Done` |
| idle/unknown | `is-idle` / 不渲染 | 沿用（卡片本来就显示 Idle 灰） |

`.is-seen` 定义在 `tab/tab-card.scss`（或卡片所属样式文件）与 `agent-hover-card` 的局部样式，遵守既有 `is-acked` 视觉语言（`--secondary-text-color` + `opacity: .7` + 无 animation）。

## 6. 兼容与风险

| 风险 | 处理 |
|---|---|
| 既有 5 个测试断言 `agentStatusPresentation` / `presentCanonicalAgentStatus` | 不改这两个函数签名与行为 |
| 卡片面新增订阅 `doneAckedAtAtom` + `seenAtAtom` 导致 hover 卡频繁 re-render | 卡片本身已 `React.memo`；atom 只在 ack 时跳变（低频）；用 `useAtomValueSafe` 读 |
| 跨窗口 ack 不同步 | 沿用 localStorage `storage` 事件订阅（与 doneAckedAt 一致） |
| `blockViewedAtAtom` 被误当 seen 源 | 明确不复用；`resolveAgentSeenAt` 只接 doneAckedAt + seenAt |
| localStorage 新增 key 迁移 | 缺省 `{}`，无需迁移 |
| `tab-info-card-model.presentAgentState` 有测试 | 保留原签名做 shim：新增 `presentAgentStateFromView(view)`，旧函数不动 |

## 7. 回滚

每期独立可回滚：
- P1 只新增文件（不接入）→ 直接 revert 文件。
- P2 三面接入由 `VIEW_V2` 不再需要 flag：改动集中在 3 个组件的渲染分支 + 1 个样式类，revert 即恢复。
- P3 收口函数替换是等价的，revert 后回到散落直写（行为不变）。
