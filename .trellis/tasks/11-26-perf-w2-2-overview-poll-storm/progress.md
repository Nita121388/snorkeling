# W2-2 进度记录（2026-11-26 白天收工，晚上继续）

> 包：`N-1126-perf-w2-2-overview-poll-storm`（P0 / bug）
> 龙门：g2 已 clear（red-proof 落盘）；pick 已落账（running）
> **状态：代码实现完成、目标判据全绿；整包验证未跑完（用户要求先记录收工）**

## 一、已完成

### 1. 红证（g2 clear）
`.trellis/tasks/11-26-perf-w2-2-overview-poll-storm/red-proof.txt`
4 个用例全部按预期根因失败（其余 40 个同命令用例绿）：

| 用例 | 红因 |
|---|---|
| `overview-board-rerender.test.tsx` | 仅 `now` 变化的重渲触发 3 次 `getBoundingClientRect`（期望 0） |
| `send-status-chip-rerender.test.tsx` | 敲一个字符让 chip commit 2 次（期望 1），context 击穿 card memo |
| `session-overview-session-cache.test.ts`（新增用例） | Summary 强刷返回等价数据仍 bump revision 29>28 |
| `agent-status-tab-aggregate.test.ts`（新增用例） | `getWorkspaceBlockIdsAtom` 全集含普通终端/preview |

### 2. 实现（4 处收口，9 个文件）
1. **`overview-board.tsx`**
   - `columns` 改 `useMemo`（batch memo 化根因）→ `columnKeys`/`rebaseline` 引用稳定，layout effect 与 `ResizeObserver` 不再每渲染重建；
   - `captureBoardSnapshot` 增加 `elementsOverride`，layout effect 内节点只 `querySelectorAll` 一次（去掉重复查询）；
   - `BoardCard` 的 `onDragStartCard` 改为稳定签名 `(card, event)`，看板只传一个 `useCallback`，不再每渲染为每卡新建闭包（修 memo 击穿）；
   - 顺手清掉一条既有死代码（`?? "" ?? row.text` → `TS2881`，tsc 净减 1）。
2. **`session-overview-session-cache.ts`**
   - `storeSummaryResult` 真正启用已存在但从未被调用的 `isSameSessionSummary`：实质无变化只刷新 `loadedAt`，不 bump `summary` 频道；
   - `loadCachedSessionDetail` 的 summary 联动写入同样按等价去重（`detail` 频道照旧 bump）。
3. **`session-overview.tsx`**
   - `loadSummary` 的两处 `setSummaries` 加等价判等：缓存命中占位与强刷结果实质无变化时 `return prev`（原实现每会话每 15s 写两次 → 约 40 次整板重渲）。
4. **`overview-card-send-panel.tsx`**
   - 草稿态从 React state 搬进 per-instance jotai atom（`draftAtom`）；`CardSendContext` 的 value 不再随每次按键换引用 → 全板 `SendStatusChip` 不再被击穿；
   - `CardSendState.draftByBlock` 保留为同步 getter（`draftStore.get(draftAtom)`），**不**进 `useMemo` deps，故既有读法（含 4 个套件外部契约）零改动；
   - 新增 `useCardSendDraft(blockId)` 给 composer 订阅草稿。
5. **`agent-status-tab-aggregate.ts`**
   - `getWorkspaceBlockIdsAtom` 导出 + 用 `isAgentTerminalMeta` 过滤（与消费侧 `getTabAgentStatusEntriesAtom` 同一判定），普通终端/preview/webview 不再各发一次 `GetAgentStatus` RPC + WPS 订阅。

### 3. 已通过的判据
- 判据 1（目标套件）：`Test Files 8 passed / Tests 88 passed`
- 整包 `frontend/app/session-overview` + `frontend/app/agent-status` 串行（`--no-file-parallelism`）：**47 files / 548 tests 全绿**
  - 注意：并行跑会 `Fatal process out of memory: Zone`（本机 Commit 紧张），**必须加 `--no-file-parallelism`**。
- tsc 增量（干净 HEAD worktree 对照，排除并行任务未提交改动干扰）：
  - 干净 HEAD `0137a4da6` = **58** 条；打上本包 9 个文件后 = **57** 条；
  - 错误集合 diff：新增 **0**、减少 1（本包修掉的 `TS2881`）。

## 二、留下的坑 / 晚上要继续的点

1. **`node scripts/check-tsc-baseline.mjs` 这道门在当前仓库必然红**（与本次改动无关）：
   - `docs/project/tsc-baseline.json` = `47`（2026-11-05 冻结）；
   - 干净 HEAD 实测 = `58`，工作区叠加其它并行任务未提交改动 = `60`；
   - 即基线数字早已过期，需要人决定是「单独一个 chore 包把它下调/校准到 58」还是「本包豁免这条判据」。本包 touch 白名单不含该 json，未擅自抬基线。
2. **整包判据 2 的最后一次复跑被打断**（用户要求收工）。复跑命令：
   `npx vitest run frontend/app/session-overview frontend/app/agent-status --no-file-parallelism`
3. **G7 真机验收未做**：需重启 `wavesrv` + `Snorkeling`，确认
   - 点卡片 / 30s tick 不再全板回流（可用 CDP 采样 `getBoundingClientRect` 计数）；
   - Overview 15s 轮询时整板不再抖动重渲；
   - 在卡 composer 里打字，其它卡 chip 不闪；
   - 普通终端 Tab 不再对每个块发 `GetAgentStatus`。

## 三、收工时的待办序列（晚上照此接手）

```bash
# 1) 复跑整包（注意串行）
npx vitest run frontend/app/session-overview frontend/app/agent-status --no-file-parallelism
# 2) 判据 3 待人工裁决后处理（见「二-1」）
node E:/primary/projects/loop/bin/loop.mjs queue prove --id N-1126-perf-w2-2-overview-poll-storm --root E:/code/snorkeling
# 3) 全绿后落账
node E:/primary/projects/loop/bin/loop.mjs ledger.mjs add --id N-1126-perf-w2-2-overview-poll-storm \
  --action verify --to green --evidence "<prove 输出摘要>" --root E:/code/snorkeling
```

## 四、本次改动文件（9）

```
frontend/app/session-overview/overview-board.tsx
frontend/app/session-overview/overview-board-rerender.test.tsx        (新增)
frontend/app/session-overview/session-overview.tsx
frontend/app/session-overview/session-overview-session-cache.ts
frontend/app/session-overview/session-overview-session-cache.test.ts
frontend/app/session-overview/overview-card-send-panel.tsx
frontend/app/session-overview/send-status-chip-rerender.test.tsx      (新增)
frontend/app/agent-status/agent-status-tab-aggregate.ts
frontend/app/agent-status/agent-status-tab-aggregate.test.ts
```

> 未改 `send-status-chip.tsx`（白名单里有但无需改：chip 本来只读 context，收口在 context 源头）。
