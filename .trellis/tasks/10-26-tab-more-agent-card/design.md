# 技术设计：Tab「更多」下拉悬浮展示 Agent Card

## 1. 现状（代码坐标）

### 下拉面板
| 位置 | 现状 |
|---|---|
| `frontend/app/tab/tab-more-menu.tsx` | `TabMoreRowItem` 每行只渲染 `TabBadges + 名称 + ✕`；无 agent 信息浮层 |
| `frontend/app/tab/tab-more-model.ts` | `TabMoreMeta` = `{ name, badges, agentDots, flagColor }`；无 `blockIds` |
| `frontend/app/tab/tabbar.tsx:1015` / `vtabbar.tsx:668` | 两栏共用 `TabMoreMenu`，`tabIds` 入参 |

### 现成的悬浮卡机制（关键复用点）
| 位置 | 用途 |
|---|---|
| `frontend/app/block/block.tsx:192,455,586` | `useInfoCardHover({ placement, targetRef })` + `BlockInfoCard()` + `InfoCardPortal` —— block header 悬浮卡完整范式 |
| `frontend/app/block/block-info-card.tsx` | 分派器：agent block → `AgentHoverCard` |
| `frontend/app/view/term/agent-hover-card.tsx` | `AgentHoverCard` —— 完整卡片（logo / provider / model / 状态点 / note+tags / session id 复制） |
| `frontend/app/element/info-card/info-card-hover.tsx` | `useInfoCardHover` + `useInfoCardDismiss` —— 300ms 延迟关闭、移入保活、点外侧关闭、全局独占 |
| `frontend/app/element/info-card/index.ts` | `InfoCardPortal` 导出 |
| `frontend/app/agent-status/agent-status-tab-aggregate.ts` | `getTabAgentStatusDotsAtom` 已有「按 tab 聚合 agent 状态点」逻辑，可作为「该 tab 内有哪些 agent block」的参考，`getWorkspaceBlockIdsAtom` 已能展开 `tab.blockids + 各自 subblockids` |

### 关键事实
- `Tab` 的 `blockids` 是其顶层 block，inline 子 block 在 `Block.subblockids`。
- agent block 判定：`isAgentTerminalMeta(block.meta)`（`frontend/app/view/term/agent-meta.ts`）。
- `BlockInfoCard` 接受 `{ blockId, blockData, mode }`，mode `gui` / `tui` 当前渲染一致。

## 2. 目标

1. 「更多」下拉每一行 hover（mouseenter，延迟 300ms，可移入卡片）时浮出该 Tab 内的 agent 会话卡片。
2. 1 个 agent → 完整 `AgentHoverCard`（与 block header 悬浮卡完全一致）。
3. ≥2 个 agent → 最近更新的那个出完整卡，其余压成一行紧凑条目（logo + provider·model + 状态点 + 短 session id）。
4. 0 个 agent → 不出卡（保留原生 title tooltip 行为）。
5. 完全复用现有 `useInfoCardHover` / `InfoCardPortal` / `AgentHoverCard`，不新造卡片组件逻辑。

## 3. 数据流（改造后）

```
TabMoreMenu
  └─ 每行 TabMoreRowItem
       ├─ 已有：TabBadges + 名称 + ✕
       └─ 新增：useInfoCardHover({ placement: "right", targetRef })
            └─ hover 时渲染 InfoCardPortal
                 └─ 解析该 tab 的 blockids（顶层 + subblockids）
                      ├─ 过滤 isAgentTerminalMeta(block.meta)
                      ├─ 按 updatedAt 取最近一个 → AgentHoverCard（完整）
                      └─ 其余 → 紧凑行（AgentMiniRow）
```

## 4. 实现方案

### 4.1 model 层（纯函数，可测）
`tab-more-model.ts`：
- `TabMoreMeta` 增加 `blockIds: string[]`（在 `getTabMoreMetaAtom` 里把 `tab.blockids` + 各 block 的 `subblockids` 一并收集；缺失 meta 的跳过）。
- 新增 `collectTabAgentBlocks(meta: TabMoreMeta, getBlock): AgentBlockInfo[]`：
  - `AgentBlockInfo = { blockId, blockData, updatedAt }`
  - 过滤 `isAgentTerminalMeta`，按 `updatedAt` 降序。
  - 纯函数，测试直接给 meta + 假的 getBlock。

### 4.2 UI 层
- 新文件 `frontend/app/tab/tab-more-agent-card.tsx`：
  - `TabMoreAgentCard({ blocks: AgentBlockInfo[] })`：
    - `blocks.length === 0` → 返回 `null`（调用方据此决定不渲染 portal）。
    - `blocks.length === 1` → `<AgentHoverCard blockId mode="gui" />`。
    - `blocks.length >= 2` → 首块 `<AgentHoverCard blockId mode="gui" />`，其余 `blocks.slice(1).map(<AgentMiniRow />)`。
  - `AgentMiniRow({ block })`：紧凑单行 `logo + provider·model + 状态点(复用 TabAgentStatusDot) + 短 session id`，无 note/tags（避免卡过高）。
- `TabMoreRowItem` 改造：
  - 拿 `targetRef` + `useInfoCardHover({ placement: "right" })`。
  - 行 `targetProps` 接上；`cardContent = TabMoreAgentCard({ blocks })`；`blocks.length > 0` 时渲染 `<InfoCardPortal hover={cardHover}>{cardContent}</InfoCardPortal>`。
  - 注意：`useInfoCardHover` 在每行独立实例化，全局独占管理器（`claimInfoCard`）会保证同一时刻只有一个卡片开着，无需手动处理。

### 4.3 边界
- 浮层贴边：`useInfoCardHover` 的 `refreshCardPos` 已按 placement 算坐标；右侧放不下时可改 `placement: "left"`（按面板位置定：垂直栏面板向上弹、行本身在左栏，默认 `right` 应够；水平栏面板向下弹、行在顶栏，默认 `right`）。
- 窗口 resize / 面板滚动：`useInfoCardHover` 不自动重算，但 hover 期间触发频率低，可接受；如后续需要可接 `refreshCardPos`。
- 搜索框聚焦时：只走行 hover，不影响输入。
- 键盘：`Enter`/`Space` 仍是切 Tab，卡片不抢焦点（与 block header 一致）。
- 性能：`getTabMoreMetaAtom` 已一次性读全部 tab meta；新增 blockIds 只是同一次读取里多拿 `subblockids`，不额外 RPC。agent block 的 `AgentHoverCard` 内部 `useAgentStatusForCard` 等是按需（hover 才渲染），不 hover 不订阅。

## 5. 多 agent 卡片布局（ASCII）

```
 单 agent（完整卡，与 block header 悬浮卡一致）：
 ┌─────────────────────────────────┐
 │ 🟢 Claude · Opus 4.1            │
 │ ● working · 3m                 │
 │ ─────────────────────────────── │
 │ Note: 修复登录态丢失            │
 │ #bug #auth                      │
 │ ─────────────────────────────── │
 │ 019ac1f4…              [copy]   │
 └─────────────────────────────────┘

 多 agent（1 完整 + 其余紧凑行）：
 ┌─────────────────────────────────┐
 │ 🤖 3 agents in this tab         │
 ├─────────────────────────────────┤
 │ 🟢 Claude · Opus 4.1            │
 │ ● working · 3m                  │
 │ ─────────────────────────────── │
 │ Note: 修复登录态丢失            │
 │ #bug #auth                      │
 │ ─────────────────────────────── │
 │ 019ac1f4…              [copy]   │
 ├─────────────────────────────────┤
 │ 🟠 Codex · GPT-5.1   ● blocked  │
 │ 019ad2c3…              [copy]   │
 ├─────────────────────────────────┤
 │ 🟣 Pi · v4          ● done · 1h │
 │ 019ad7e9…              [copy]   │
 └─────────────────────────────────┘
```

## 6. 测试

### 单测（`tab-more-model.test.ts`）
- `collectTabAgentBlocks`：空 blockIds → `[]`。
- 过滤掉非 agent block（note / preview / session detail）。
- 多 agent 按 `updatedAt` 降序。
- `subblockids` 里的 inline agent block 也被纳入。

### DOM 测试（`tab-more-menu.dom.test.tsx`）
- hover 有 1 个 agent 的行 → portal 出现完整 `AgentHoverCard`（断言 session id / provider 文本）。
- hover 有 2 个 agent 的行 → portal 出现「N agents in this tab」+ 首块完整 + 次块 `AgentMiniRow`。
- hover 0 个 agent 的行 → 无 portal（保留原生 title）。
- 移出 300ms → 卡片消失（沿用 `useInfoCardHover` 既有行为）。

## 7. 影响文件

- `frontend/app/tab/tab-more-model.ts`（加 `blockIds` + `collectTabAgentBlocks`）
- `frontend/app/tab/tab-more-agent-card.tsx`（新）
- `frontend/app/tab/tab-more-menu.tsx`（`TabMoreRowItem` 接 hover + portal）
- `frontend/app/tab/tab-more-model.test.ts`
- `frontend/app/tab/tab-more-menu.dom.test.tsx`

---

## 8. 实现备注（2026-10-27，落地后回填）

实施与 §4 的两处偏差，均已实现并验证：

1. **`TabMoreMeta` 多了一个 `agentBlockIds`**
   `blockIds` 是一次 block 读取的副产品，`agentBlockIds` 是同一次读取里直接过滤出的 agent 子集。
   行渲染只需 `agentBlockIds.length > 0` 就能决定是否挂 portal，避免每行都去订阅 agent 状态。

2. **DOM 测试只锁「数据链路 + 挂载点」，不渲染完整卡片**
   jsdom 里 `AgentHoverCard` 会走 `AISessionsService.Summary` → `callBackendService` →
   `window.globalAtoms`（测试环境未挂载）+ 真实 web 端点，必抛错（与本仓库
   `block-info-card.test.tsx`「只断言分派、不渲染卡片」的既有约定一致）。
   因此：
   - 行上加 `data-agent-card="true|false"`，DOM 测试断言 0/1/2 个 agent 与 inline 子 block 的收集结果；
   - 卡片内容由 `collectTabAgentBlocks` 单测 + 复用既有 `AgentHoverCard` 保证。

3. **顺带修了一个缓存 bug**
   `TabMoreMetaAtomCache` 原先只用 `tabIds.join(" ")` 做 key，跨 env（preview / 测试 mock env）
   会复用上一个 env 的 atom，读到旧的 tab/block 数据。改成
   `WeakMap<env, Map<key, Atom>>`，与新增的 `AgentBlocksAtomCache` 同一口径。

4. **多 agent 排序**
   按 `AgentStatusStore.peekPresentedStatusAtom/peekStatusAtom` 的 `updatedAt` 降序；
   拿不到状态时间时退回 `agentBlockIds` 原始顺序（稳定排序）。

### 测试环境注意
本机 Node 26 下 jsdom 不再默认提供 `localStorage`，`SessionOverviewModel` 构造即抛
`Cannot read properties of undefined (reading 'getItem')`。这是**既有环境问题**（HEAD 上同样 13 条
`tab-more-menu.dom.test.tsx` 全红），与本次改动无关。跑法：

```bash
NODE_OPTIONS="--localstorage-file=/tmp/nodelocalstorage.json" \
  npx vitest run frontend/app/tab/tab-more-model.test.ts frontend/app/tab/tab-more-menu.dom.test.tsx
```
