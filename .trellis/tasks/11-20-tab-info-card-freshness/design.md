# Design — Tab 悬浮卡数据新鲜度

## 边界

| 位置 | 动作 |
|---|---|
| `frontend/app/tab/tab-block-collect.ts` | 新建：共享纯函数 `expandBlockIdsWithSubblocks(blockIds, getBlock)`（顶层 + `subblockids`，保序去重） |
| `frontend/app/tab/tab-block-collect.test.ts` | 新建：展开逻辑单测（node 环境） |
| `frontend/app/tab/tab-info-card.tsx` | 改：派生 atom 订阅 tab/workspace/blocks；`TabAgentRow` 收 block prop，删 `getObjectValue` / `useMemo([blockId])` 冻结 |
| `frontend/app/tab/tab-info-card.dom.test.tsx` | 新建：由 tmp 复现用例转正 + inline 子块用例 |
| `frontend/app/agent-status/agent-status-tab-aggregate.ts` | 改：`expandBlockIdsWithSubblocks` 改为调用共享纯函数（薄包装，语义不变） |
| `frontend/app/tab/tab-more-menu.tsx` | 不改（已有 `collectTabBlockIds` 同口径）；仅在必要时代码注释指向共享函数 |
| `design/plans/tab-info-card-stale-20261120.md` | 改：状态 → 已落地 + 实现记录 |
| `docs/project/verify-ledger.md` | 改：追加一行真机验证结论 |

爆炸半径：`TabInfoCard` 唯一调用点 `tab/tab.tsx:240`（测试除外）；共享纯函数被 3 处消费，其中只有 aggregate 是 HIGH 影响 → 用「薄包装 + 不改判定顺序」的方式收敛风险。

## 数据流

现状（快照）：

```
TabInfoCard render ──getObjectValue(one-shot)──> waveObjectValueCache.atom.value
                        ✗ 无订阅：waveobj:update 后不重渲染
```

目标（订阅）：

```
TabInfoCard
  └─ useAtomValue(getTabCardDataAtom(tabId, workspaceId))   ← 派生 atom（按 tabId|workspaceId 缓存）
        ├─ get(tabAtom)                                     ← 订阅 tab（blockids / name / flag）
        ├─ get(workspaceAtom)                               ← 订阅 workspace（icon / color）
        └─ for blockId of expandBlockIdsWithSubblocks(...)
              get(blockAtom)                                ← 订阅每个块（meta 迟到/变化都触发）
     产出 { tab, workspace, blocks, counts, agentEntries }
  └─ TabAgentRow（block 由 props 下传，只额外订阅 AgentStatusStore 的 status atom）
```

关键点：

1. **每个 oref 的 atom 只 `get` 一次**（在同一次 derive 内），订阅集合随 `tab.blockids` / `subblockids` 自动更新；jotai 会解绑旧依赖。
2. **派生 atom 必须按 `tabId|workspaceId` 缓存**（`Map<string, Atom<...>>`），否则每次 render 新建 atom → `useAtomValue` 的 dep 抖动 → 历史上出现过的 "Maximum update depth exceeded"（见 `agent-status-tab-aggregate.ts` 里 `TabAgentStatusDotAtomCache` 的注释、`tab-more-menu.tsx` 的 `TabMoreMetaAtomCache`）。
3. atom 直接从 `@/app/store/wos` 取（与现状一致：该组件本来就 import 了模块级 `getObjectValue`），不引入 `useWaveEnv` 依赖，preview/mock 行为不变。
4. `counts` / `agentEntries` 复用 `tab-info-card-model.ts` 的 `countTabBlocks` / `classifyTabBlock`，不新增判定。
5. agent 行数现在可能包含子块 → `agentCount` 取 `agentEntries.length`（当前取 `counts.agent`，两者在展开后必须一致；实现时让 `counts` 也基于展开后的 block 列表计算，保证 header 计数与行数不打架）。

> 注：`counts` 基于展开后列表会让「agent 在 Blocks 组里」的 Tab 的 chips 里不再出现父块（父块 `view: "tabs"` 归 `other`）—— 这是符合预期的口径变化：agent 行出现后不再报「1 other」。写进实现记录。

## 契约（新增共享纯函数）

```ts
// frontend/app/tab/tab-block-collect.ts
/**
 * 一个 Tab 的 block id 全集：顶层 blockids + 各 block 的 subblockids（保序、去重）。
 * getBlock 由调用方注入（Getter / env.wos / 直接 WOS），保持纯函数可单测。
 */
export function expandBlockIdsWithSubblocks(
    blockIds: readonly string[],
    getBlock: (blockId: string) => Block | null
): string[];
```

三处消费：

- `agent-status-tab-aggregate.ts`：`expandBlockIdsWithSubblocks(blockIds, (id) => get(WOS.getWaveObjectAtom<Block>(makeORef("block", id))))`（与现实现逐行等价）。
- `tab-more-menu.tsx#collectTabBlockIds`：内部循环改为调共享函数后再遍历（或保持现状 + 注释指向，二者等价则优先「先不动」，避免扩大 diff）。
- `tab-info-card.tsx`：派生 atom 内调共享函数。

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 派生 atom 缓存 key 不稳定导致重渲染风暴 | key = `${tabId}|${workspaceId ?? ""}`；atom 只在 key 首建时创建并缓存；dom 测试断言 mount 后 `useAtomValue` 不稳定会直接报 React 错误 |
| 展开子块让 header agent 计数变化（视觉变化） | 预期口径修正，写进实现记录；像素不回归，只影响数值正确性 |
| aggregate 重构破坏状态点 | 薄包装，`agent-status-tab-aggregate.test.ts` 不改断言跑通即为证据 |
| 卡片打开期间 block 大量变化造成频繁 derive | 卡片只在 hover 打开；derive 只做分类计数，O(块数) |

回滚：改动集中在 3 个文件 + 1 个新纯函数模块，`git revert` 单提交即可（不改数据/配置）。

## 验证

- `npx vitest run frontend/app/tab/tab-info-card.dom.test.tsx frontend/app/tab/tab-block-collect.test.ts frontend/app/tab/tab-info-card-model.test.ts frontend/app/agent-status/`
- `npx tsc --noEmit`（改动文件无新增错误）
- 真机：`scripts/verify` 起实例 → 两 Tab，非激活 Tab 内 agent 块 → hover 读 `.tab-card-agent-list` 行数 / provider 文案；台账追加一行。
