# Implement — Tab 悬浮卡数据新鲜度

## 顺序（每步都可单独验证，出错可停在这里）

[x] *共享纯函数**
   - 新建 `frontend/app/tab/tab-block-collect.ts`：`expandBlockIdsWithSubblocks(blockIds, getBlock)`（从 `agent-status-tab-aggregate.ts` 的私有实现搬出，签名改为注入 `getBlock`）。
   - 新建 `frontend/app/tab/tab-block-collect.test.ts`：顶层保序、含子块、重复 id 去重、getBlock 返回 null 不炸。
   - 验证：`npx vitest run frontend/app/tab/tab-block-collect.test.ts`

[x] *aggregate 薄包装（HIGH 影响，最小 diff）**
   - `agent-status-tab-aggregate.ts#expandBlockIdsWithSubblocks` 改为薄包装调用共享函数，删除私有循环。
   - 验证：`npx vitest run frontend/app/agent-status/` **不改任何断言**全绿（R4 证明）。

[x] *TabInfoCard 改响应式**
   - 新增 `getTabCardDataAtom(tabId, workspaceId)`（模块内 `Map` 缓存）：订阅 tab atom → 展开 blockIds → 订阅每个 block atom + workspace atom；产出 `{ tab, workspace, blocks, counts, agentEntries }`。
   - `TabInfoCard` 用它替换三处 `getObjectValue`；`agentCount` 用 `agentEntries.length`（与行数一致）。
   - `TabAgentRow` 改签名接收 `block: Block | null`（删掉内部 `getObjectValue` + `useMemo([blockId])`），provider / emoji 从 prop 推导；status 仍走 `AgentStatusStore.acquire` + `useAgentStatusView`。
   - 验证：`npx vitest run tmp/tab-info-card-stale.repro.test.tsx` 由红转绿。

[x] *用例转正 + 扩充**
   - `git mv` 等价操作：把 `tmp/tab-info-card-stale.repro.test.tsx` 内容移入 `frontend/app/tab/tab-info-card.dom.test.tsx`（import 路径改回 `@/...`），新增 AC2 的 inline 子块用例。
   - 验证：`npx vitest run frontend/app/tab/ frontend/app/agent-status/`

[x] *收尾**
   - `npx tsc --noEmit`（只看改动文件是否有新错误）。
   - 真机：起验证实例（`scripts/verify` 或 `npm run dev:cdp`）→ 非激活 Tab hover 读 `.tab-card-agent-list`；台账 `docs/project/verify-ledger.md` 追加一行结论。
   - 更新 `design/plans/tab-info-card-stale-20261120.md` 状态 + 实现记录；删除 `tmp/tab-info-card-stale.repro.test.tsx`。
   - 提交：`fix(tab-card): 悬浮卡改响应式订阅 + 子块口径收口`。

## 判据（命令 → 期望）

| 命令 | 期望 |
|---|---|
| `npx vitest run frontend/app/tab/tab-block-collect.test.ts` | ≥4 用例全绿 |
| `npx vitest run frontend/app/agent-status/` | 全绿，断言未改（`git diff` 无该目录测试改动） |
| `npx vitest run frontend/app/tab/tab-info-card.dom.test.tsx` | ≥3 用例全绿（meta 变化 / 迟到加载 / inline 子块） |
| `npx tsc --noEmit` | 改动文件无新增 error |
| 真机 hover | 卡片 agent 行数 == wsh 数据展开后 agent 块数；meta 变化后不重开卡片也更新 |

## 回滚点

- 步骤 2 之后若 aggregate 测试变红 → 回滚步骤 2，保持私有实现，只在卡片侧用共享函数（R3 退化为 2/3 面统一，需在实现记录说明）。
- 步骤 3 之后若出现渲染风暴 / React 错误 → 回滚派生 atom，退回「TabInner 下传 + 行内订阅 block」方案（缓存 key 换成 props 稳定性由父保证）。

## 禁区

- 不改 `classifyTabBlock` 判定顺序、`isAgentTerminalMeta`、`presentAgentStateFromView` 等既有纯函数语义。
- 不改 `info-card.scss` 的 `.tab-card*` 段（本次是数据层修复）。
- 不新增常驻订阅（卡片卸载即释放）。
