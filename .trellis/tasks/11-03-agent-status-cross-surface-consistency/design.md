# 设计：Agent 状态跨面一致性

## 1. 现状：三条独立的呈现/订阅管线

| 面 | 数据来源 | 呈现函数 | ack 依据 |
|---|---|---|---|
| agent Block 头部（A） | `AgentStatusStore.acquire()` → `presentedAtom` | 仅 `applyStaleness` | `statusFingerprint(canonical presented)` 写 `agentStatusAckedFpAtom`；D 用 `doneAckedAtAtom` |
| Session Overview chip（O） | 自己的 `GetAgentStatus` + `agentstatus` 事件 | `presentAgentStatus`（含 idle→done 派生） | `statusFingerprint(presented done/session)` 写同一份 `agentStatusAckedFpAtom` |
| inline tab 点 / Tab 圆点 / 悬浮卡（B/C） | `AgentStatusStore` presented/raw | `agentStatusPresentation` + R/D 规则 | 同 A |

关键代码位置：

- `frontend/app/agent-status/agent-status-store.ts:118-142` presented atom = `applyStaleness(raw, Date.now())`
- `frontend/app/session-overview/session-overview.tsx:273-396` 两套独立订阅；`2144-2175` 本地派生；`2238-2246` ack 写 presented fingerprint
- `frontend/app/agent-status/agent-status-derive.ts:154-188` `presentAgentStatus`
- `frontend/app/view/term/term-model.ts:642-707` 头部徽章渲染与 ack
- `frontend/app/agent-status/agent-status-unread.ts:14-23` `statusFingerprint`
- `pkg/agentstatus/agentstatus.go:115` Go 把 `done` 归一为 `idle`，完成跳变保存在 `prevState`/`completedAt`

## 2. 根因（按影响排序）

### C1 两套"完成"语义（直接导致文案不一致）

- A 面：canonical `state=idle` + `prevState!=idle` + `completedAt>doneAckedAt` → D 闪烁，但标签取 `agentStatusPresentation(idle).label = "Idle"`，于是显示 **"Idle 10m"**。
- O 面：`presentAgentStatus` 把 `canonical idle + session 更新未读` 转成 `state:"done"`，标签 **"Done"**。
- 同一事实，两种 state、两种文案。

### C2 共享 ack map + 不同 fingerprint（导致 "ack 后复活"）

`agentStatusAckedFpAtom[blockId]` 是唯一真相，但两侧写入的 fp 由不同 status 计算：

- A: `["v2","claude","s1","hook",7,"idle","none",""]`
- O: `["v2","claude","s1","session",7,"done","none",""]`

在 A 面 ack 后，O 面比对 `presented` 的 fp ≠ 存入的 fp → 判定 unread → 重新亮；反之亦然。（已用临时 vitest 实测，见 PRD Background）

### C3 Overview 自带订阅 + 拉取无时序保护

Overview 每块各发一次 `GetAgentStatus`，再订阅 `agentstatus`。初次拉取的响应没有与事件做 `seq/updatedAt` 比较，慢响应会覆盖较新事件；且与 store 的订阅完全重复（同一 block 3 份订阅）。

### C4 15 分钟悬崖

`isRecentEnoughForDone` 15 分钟窗口让 O 面在 15 分钟后退回 idle（chip 被隐藏，因为 `shouldShowAgentStatusChip` 过滤 idle/unknown），而 A 面 D 一直亮到 ack。永久性单侧消失。

### C5 canonical 为空时单侧合成

`presentAgentStatus` 在 `canonicalStatus == null` 时回落 `deriveAgentStatus`，可凭 session 活动合成 `done`；A 面 `status == null` 直接不渲染徽章。无 hook 的 provider（gemini 等）必然只有 O 面亮。

### C6 viewedAt 只由 Overview 更新

`SessionOverviewModel.markBlockViewed`（`session-overview-model.ts:167`）只在 Overview 组件内部 effect 里调用（`session-overview.tsx:2347-2355` 等）。从 Tab 直接聚焦 agent block 不更新 viewedAt → O 面在用户正看着时说 "Done"。

### C7 stale 翻转时基不同

A/B/C 用 `nowMinuteTickAtom`（60s，且仅 working 时订阅），O 用 `useNow(overviewVisible)`（30s，仅打开时）→ 边界最多 30s 差。轻微。

## 3. 目标架构：一个 presented atom，所有面共享

```
        canonical AgentStatus (Go, 单一事实)
                    │  GetAgentStatus(1次) + agentstatus 事件(1份订阅)
                    ▼
        AgentStatusStore (blockId → entry)
            rawAtom        : AgentStatus | null
            presentedAtom  : 从 rawAtom 派生
                ├─ null → null（所有面都不显示，保持一致）
                ├─ canonical idle + prevState!=idle(unknown) → state="done"（解决 C1/C4）
                └─ 其它 → applyStaleness
                    │
     ┌──────────────┼───────────────┬────────────────┬──────────────┐
     ▼              ▼               ▼                ▼              ▼
 term header    Overview chip   inline tab dot   Tab 圆点聚合   悬浮卡
 (A)            (O)             (B)              (C)            (D)
     └──────────────┴───────────────┴────────────────┴──────────────┘
                   同一个 AgentStatus 对象 → 同一个 statusFingerprint
                        → 同一份 ack 对所有面立即生效（解决 C2）
```

### 3.1 派生函数（`agent-status-derive.ts`）

新增无副作用纯函数（保留 `presentAgentStatus` 供测试/阶段二复用）：

```ts
// idle 且存在完成跳变 → 呈现为 done. 不依赖 doneAckedAt：state 表示"这一轮跑完了"，
// 是否已阅由上层 unread 判定（fingerprint + doneAckedAt）表达，避免 ack 后 chip 直接消失。
export function presentCanonicalAgentStatus(status: AgentStatus | null, nowMs: number): AgentStatus | null {
    if (status == null) return null;
    if (status.state === "idle" && status.prevState != null && status.prevState !== "idle" && status.prevState !== "unknown") {
        return { ...status, state: "done", phase: "none" };
    }
    return applyStaleness(status, nowMs);
}
```

决策 D1：`done` 一旦出现就保持到下一次非 idle 事件（由 Go 的 completedTransition 生命周期管理），**不由 ack 撤销**。ack 只灰化，不改 state。这样：
- Overview chip 不会在 ack 后突然消失；
- 头部文案稳定为 "Done"，与 chip 一致；
- 15 分钟悬崖消失（C4）。

### 3.2 Store（`agent-status-store.ts`）

```ts
const presentedAtom = atom((get) => {
    const raw = get(statusAtom);
    if (raw == null) return null;
    if (raw.state === "working") get(nowMinuteTickAtom);
    return presentCanonicalAgentStatus(raw, Date.now());
});
```

- `acquire()` 已返回 presented atom，因此 A/B/C 自动获得 `done` 态，无需改动。
- `peekPresentedStatusAtom()` 同理。

### 3.3 Overview 改为消费者（`session-overview.tsx`）

删除：
- `useBlockControllerStatuses`（273-329）
- `useCanonicalAgentStatuses`（331-396）
- `runOverviewRequests` / `OVERVIEW_STATUS_REQUEST_CONCURRENCY`（412+）若不再被引用
- `presentAgentStatus` import 与 2144-2175 的本地派生

新增：

```ts
// 与 agent-status-tab-aggregate 相同的 cached outer atom 模式（避免 useAtomValue 的 atom 引用抖动）
function useOverviewPresentedStatuses(blockIds: string[], active: boolean): Record<string, AgentStatus | null>
```

实现要点：
- `active` 时对每个 blockId `store.acquire()`，unmount / 集合变化时 `release()`（配对）。
- 用 `useMemo` 缓存 `blockIdsKey` → `atom(get => ...)`，内部 `get(store.peekPresentedStatusAtom(id))`。
- 保持现有 `shouldShowAgentStatusChip` / `AggregateStatusChip` 逻辑不变（它们只看 state，`done` 已在 stateRank 中）。

ack（`2238-2246`）：
```ts
const ackAgentStatus = (blockId, status) => {
    overviewModel.markAgentStatusAcked(blockId, Date.now(), status); // 现在 fp 与头部一致
    agentStatusDoneAckStore.markDoneAcked(blockId, Date.now(), "overview-chip"); // D 也一起清
};
```
并让 chip 的 unread 同时考虑 D：`unread = isAgentStatusUnread(status, fp) || isAgentDoneUnread(status, doneAckedAt)`，与头部 R/D 规则对齐。

### 3.4 term-model 头部（`term-model.ts:642-707`）

改动很小：state 变为 `done` 后 `agentStatusPresentation` 返回 label "Done"，`is-${state}` 变成 `is-done`（scss 已有 `.is-done`）。现有 `doneUnread` 分支保留，文案自然变成 "Done 10m"。确认 `allRead && state==="idle"` 的 "Seen" 分支不受影响（done 时不进该分支 → acked 的 done 显示灰色 "Done"，可接受）。

### 3.5 inline tab / Tab 圆点

`buildAgentStatusDot` 的过滤条件是 `(idle|unknown) && !doneUnread → null`。state 变 `done` 后走正常渲染分支；`is-done` scss 已存在。无需改逻辑，但要回归验证 D 点仍能灰化。

## 4. 阶段划分

| 阶段 | 内容 | 风险 | 说明 |
|---|---|---|---|
| S1 | 3.1 + 3.2（store 产出 done） | 低 | 纯前端派生，Go 不动 |
| S2 | 3.3（Overview 改读 store，删重复订阅） | 中 | 删代码多，需保证 acquire/release 配对 |
| S3 | 3.3 ack 统一 + chip R/D 规则 | 中 | 修 C2（用户主诉） |
| S4 | 3.4/3.5 文案与视觉回归 | 低 | scss 已具备 |
| S5（可选） | viewedAt 提升为全局（C6）；无 hook provider 的 session 派生（C5） | 中 | 依赖用户对 Q2 的答复 |

S1+S2+S3 完成即覆盖 AC1/AC2/AC5/AC6/AC7；AC3 由 S1 解决；AC4 需要 S5，若不接受 S5 则把 AC4 改为"两侧均不显示"。

## 5. 兼容与回滚

- 不改 Go 协议；`presentAgentStatus` / `deriveAgentStatus` 保留导出，测试继续通过（可标注 deprecated）。
- 回滚点：S1/S2/S3 各自独立 commit；S2 回滚只需恢复两处 hook。
- `blockViewedAtAtom` 在 S5 前保持原状，Overview 的"未读消息"计数逻辑不受影响。

## 6. 测试设计

新增 `frontend/app/agent-status/agent-status-cross-surface.test.ts`：

1. `presentCanonicalAgentStatus(idle+prevState)` → `done`；`idle` 无 prevState → `idle`。
2. 同一 canonical 经 A 面（store 派生）与 O 面（若保留 `presentAgentStatus`）产出的 `statusFingerprint` 必须相等 → ack 互认。
3. 场景 A/B/C（PRD Background 三条实测）转成断言：ack 后两侧同时 read；15 分钟后仍是 done；canonical null 两侧同为 null。
4. 头部文案：presented=done 时 `agentStatusPresentation().label === "Done"`。
