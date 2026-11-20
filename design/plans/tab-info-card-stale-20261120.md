# Tab 悬浮卡（TabInfoCard）agent 信息不更新 — 排查进度与修复方案

> 状态：**已修复并落地**（2026-11-20 下午排查 / 晚上实施）。任务：`.trellis/tasks/11-20-tab-info-card-freshness`
> 症状：鼠标悬浮在**非激活** Tab 上，悬浮信息卡展示的 agent 列表 / provider / 分类计数不准确，数据似乎没有及时更新。

## 1. 涉及代码（调用链）

```
tabbar.tsx (TabV)
  └─ InfoCardPortal (hover 期间挂载)          frontend/app/element/info-card/info-card-hover.tsx
       └─ TabInfoCard                          frontend/app/tab/tab-info-card.tsx
            ├─ getObjectValue(tab / workspace / block)   ← 一次性快照读，不订阅
            ├─ classifyTabBlock / countTabBlocks          frontend/app/tab/tab-info-card-model.ts
            └─ TabAgentRow（每个 agent 块一行）
                 ├─ AgentStatusStore.acquire()           ← 状态 pill：响应式 ✅
                 └─ getObjectValue(block)（useMemo [blockId]）← 冻结一次 ❌
```

## 2. 根因（两条，均已用测试复现）

### 根因 A：整卡用 `getObjectValue()` 快照读 WaveObj，不订阅 atom

`frontend/app/store/wos.ts:400` 的 `getObjectValue` 是**一次性读缓存**，不会建立任何订阅。`TabInfoCard` 三处用它（tab.tsx 之外唯一的使用面），`TabAgentRow` 又把 block 读取包在 `useMemo([blockId])` 里 → **卡片打开期间 block 对象的变化（含迟到加载）永远不会触发重渲染**：

- 场景 A1（**首次 hover 残数据**）：非激活 Tab 的块从未挂载过视图时，`getObjectValue` 首次读取返回 `null`（同时才触发 GetObject 拉取），该块被 `classifyTabBlock(null)` 判为 `other`；数据毫秒后抵达 atom，但卡片没有订阅 → 整个 hover 期间一直显示「0 agents / 1 other」。
- 场景 A2（meta 变化不反映）：agent 启动/绑定 session 的 meta 写入（`agent:sessionid` / `agent:provider`）发生在卡片打开期间时，分类结果和行内 provider/emoji 全部停留在旧快照。
- 卡片关闭再打开会重新 mount、重新快照，所以表现为「要移开再悬浮一次才对」= 用户感知的「没有及时更新」。

**复现证据**（jsdom + 真 `TabInfoCard` 组件，mock WOS）：`tmp/tab-info-card-stale.repro.test.tsx`

```
× block 的 meta 从 term 变成 agent（waveobj:update 抵达）后，卡片应显示 agent 行
  → expected 'T1tab:infoCard.chipTerm({"count":1})' to contain 'agentGroupWithProvider'
× 卡片打开时 block 对象尚未进 WOS（null），随后加载完成应自动补上 agent 信息
  → expected 'T1tab:infoCard.chipOther({"count":1})' to contain 'agentGroupWithProvider'
```

两个用例在 waveobj 更新落到 atom 后 DOM 均不变 —— 卡片对 block atom **零订阅**坐实。

### 根因 B：不展开 inline-tab 子块（`block.subblockids`），与其他两个面判定口径漂移

同一个「tab 里有哪些 agent」在三处有**三套口径**：

| 消费面 | 展开 `block.subblockids`？ | 读取方式 |
|---|---|---|
| 顶部 Tab 状态点 `expandBlockIdsWithSubblocks`（agent-status-tab-aggregate.ts:180） | ✅ | 响应式（WOS atom） |
| 「更多」菜单 `collectTabAgentBlocks`（tab-more-menu.tsx:186） | ✅ | 响应式（WOS atom） |
| **Tab 悬浮卡 `TabInfoCard`** | ❌ 只走 `tab.blockids` | 快照 `getObjectValue` |

结果：Blocks 组（inline tab）里的 agent 在悬浮卡上**完全不出现**（父块还被计成 other），但顶部状态点又亮着 → 「agent 信息不准确」。这也是非激活 Tab 更明显的原因之一：激活 Tab 里 agent 面板直接可见，用户不依赖悬浮卡。

### 为什么偏偏是「非激活」Tab 最明显

- 激活 Tab 的块有挂载视图（TermViewModel / TermWrap），WOS atom 常年有订阅、meta 是热的；非激活 Tab 的块没有任何挂载方，缓存里可能为空或旧。
- 悬浮卡打开期间唯一能自救的重渲染来源是父组件 `TabInner`（它订阅 tab 对象 / 状态点 atom）；block 级变化不在其中。
- 非激活 Tab 上用户唯一的信息来源就是这张卡，错误无处对冲。

## 3. 修复方案（晚上开工）

原则：**对齐 tab-more-agent-card 的既有做法（响应式 atom 派生），顺手收口三处漂移口径，不引入第四套判定。**

1. **TabInfoCard 全面改响应式读**
   - tab / workspace / blocks 改 `useAtomValue(env.wos.getWaveObjectAtom(makeORef(...)))`（或 `useWaveObjectValue`），删掉 `getObjectValue` 调用。
   - 推荐抽一个派生 atom（按 tabId+env 缓存，参照 `getAgentBlocksAtom` 的 WeakMap 缓存模式）：一次订阅 tab atom + 各 block atom，产出 `{tabName, flagColor, blocks, agentEntries, counts}`；`TabInfoCard` 只 `useAtomValue`。避免 hooks-per-block 数量随块数变化的坑。
2. **TabAgentRow 的 block meta 改响应式**：`getObjectValue + useMemo([blockId])` → 订阅 block atom（provider/emoji/agent 判定随 meta 到达自动刷新）。
3. **口径收口（防再次漂移）**：把「tab.blockids 顶层 + subblockids 子块」展开逻辑抽成共享纯函数（建议放 `tab-more-model.ts` 或新 `tab-block-collect.ts`），`agent-status-tab-aggregate.expandBlockIdsWithSubblocks` / `tab-more-menu.collectTabAgentBlocks` / `TabInfoCard` 三处共用。
   - 注意 `agent-status-tab-aggregate.ts` 是中心模块（GitNexus HIGH 影响），**只提取、不改判定语义**；动手前先跑 impact 分析。

### 验证判据

- 单测（转正为 `frontend/app/tab/tab-info-card.dom.test.tsx`）：把 `tmp/tab-info-card-stale.repro.test.tsx` 的两个用例移进去，断言「waveobj:update 抵达后 DOM 自动出现 agent 行 / chip 修正」。
- 单测：tab 含 inline 子块（父块 `subblockids`）时，卡片 agent 行数 == 展开后 agent 块数。
- 真机（verify 台，新增 area `tab-info-card-freshness` 或并入现有 agent-card 台）：起两 Tab，非激活 Tab 内 agent 块 meta 后到/变化 → hover 断言 `.tab-card-agent-list` 行数与 provider 文案与 wsh 数据一致；开关卡片再 hover 无回归。
- 回归：`npx vitest run frontend/app/tab/ frontend/app/agent-status/`。

## 4. 实施记录（2026-11-20 晚）

- [x] 定位调用链与读取方式差异（快照 vs 订阅）
- [x] 用 jsdom 复现测试坐实根因 A
- [x] 确认根因 B 的三面口径漂移（代码级证据）
- [x] Trellis 任务：`.trellis/tasks/11-20-tab-info-card-freshness`（prd/design/implement）
- [x] 共享纯函数 `frontend/app/tab/tab-block-collect.ts` + 单测（5 例）；aggregate 改薄包装
- [x] `TabInfoCard` 改派生 atom `getTabCardDataAtom(tabId, workspaceId)`（订阅 tab/workspace/块 + 子块），
      `TabAgentRow` 收 `block` prop，删掉 `getObjectValue` 与 `useMemo([blockId])` 冻结
- [x] 复现用例转正：`frontend/app/tab/tab-info-card.dom.test.tsx`（5 例：基线 / term→agent / 迟到加载 /
      inline 子块 / 子块后到）
- [x] 验证台：`scripts/verify/tab-info-card-freshness/verify.mjs`（真机 hover + renderer RPC 写 meta）
- [x] spec 回写：`quality-guidelines.md`「渲染期读 WaveObj 必须订阅 atom」+ dom mock 单例死循环坑

### 实现中的两个口径变化（有意为之）

1. **chips 计数现在包含 inline 子块**：agent 出现在 Blocks 组里时，卡片不再同时报父块「1 other」。
   header 的 agent 计数改用 `agentEntries.length`（与行数同源），不会再出现「写着 3 个 agent 只列 2 行」。
2. **aggregate 的 `expandBlockIdsWithSubblocks` 变成薄包装**：判定顺序/输出保持不变，
   `agent-status-tab-aggregate.test.ts` 断言未改、177 例全绿即为证据。

### 验证证据

| 项 | 命令 | 结果 |
|---|---|---|
| 共享函数 | `npx vitest run frontend/app/tab/tab-block-collect.test.ts` | 5/5 |
| 悬浮卡新鲜度 | `npx vitest run frontend/app/tab/tab-info-card.dom.test.tsx` | 5/5 |
| 回归 | `npx vitest run frontend/app/tab/ frontend/app/agent-status/` | 24 文件 / 301 例全绿 |
| 类型 | `npx tsc --noEmit` | 改动 3 文件 0 error（仓库其余 58 处来自其他在途任务） |
| lint | `npx eslint <改动文件>` | 干净 |
| 真机 | `node scripts/verify/tab-info-card-freshness/verify.mjs` | 见 `docs/project/verify-ledger.md` |

## 5. 临时文件

- `tmp/tab-info-card-stale.repro.test.tsx` — 复现测试（vitest 可直接跑：`npx vitest run tmp/tab-info-card-stale.repro.test.tsx`），开发完成后转正进 `frontend/app/tab/` 并删除。
