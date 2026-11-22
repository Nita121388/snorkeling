# Design：Overview Tab 分组 tab-first 化

> PRD：本任务 `prd.md`。UX：父任务 `ux-ascii.md` §① ② ⑤

## 1. 边界

改动全部在前端：
- `frontend/app/store/wos.ts`（新增 `primeWaveObjects` 导出）
- `frontend/app/session-overview/overview-tab-groups.ts`（新，纯函数）
- `frontend/app/session-overview/session-overview.tsx`（`useOverviewBlocks` 接批量 prime、`displayedTabGroups` 改用新纯函数、组渲染四状态、汇总行）
- `frontend/app/session-overview/session-overview.scss`（灰行/骨架/徽章样式）
- i18n：`frontend/app/i18n/locales/*/session-overview.json`（新增 key 见 §6）

后端、`workspace.tabids` 数据层、看板/时间线视图：不动。

## 2. 数据流（新）

```text
workspace.tabids (jotai)
  │
  ├─ Phase A: WOS.primeWaveObjects(tab orefs)        ← 1 次 GetObjects
  │     └→ Tab[] (name, blockids, version)
  ├─ Phase B: WOS.primeWaveObjects(block orefs)      ← 1 次 GetObjects（>400 分批）
  │     └→ Block[]
  └→ buildTabGroups(...)  纯函数（不碰 React/jotai）
        └→ OverviewTabGroup[] = { tabId, tabName, status, blocks, blockCount, agentCount, unopened }
              └→ SessionOverviewPanel 渲染（组头常驻；loading 组画骨架）
```

要点：
- **prime 是读路径的旁路**：prime 只把已解析的对象塞进 wov cache（走 `updateWaveObject`
  的 version guard，不回退新版本）；原有 `getWaveObjectAtom` 的单件懒加载保留作为兜底。
- **两阶段的键**：`useEffect` 依赖 `[workspace?.oid, tabIdsKey]`。Phase A 完成拿到各
  tab.blockids 后立刻发起 Phase B（不必等下一个 render）。已 `loading === false` 的
  oref 跳过（幂等，切 workspace/重开不重复拉）。
- **批量上限**：单次 ≤ 400 oref，超出分批 await；19 Tab × 10 块 ≈ 190 → 一次完成。

## 3. 纯函数 `overview-tab-groups.ts`

```ts
export type OverviewTabGroupStatus = "live" | "empty" | "unopened" | "loading";

export interface OverviewTabGroup {
    tabId: string;
    tabName: string;
    status: OverviewTabGroupStatus;   // live 优先于 unopened：有可展示块且已打开 → live
    blocks: OverviewBlock[];          // 仅 status=live/unopened 填；loading 空
    blockCount: number;               // tab.blockids.length（不含 Overview 块本身）
    agentCount: number;               // blocks.filter(isAgentLike).length
    unopened: boolean;                // openedThisLaunch 无 && 非当前 tab
}

export function buildTabGroups(args: {
    tabIds: string[];
    tabById: Map<string, Tab | null>;      // null = 还没加载 → loading
    blocks: OverviewBlock[];              // 现有 useOverviewBlocks 的输出（不含 sessionoverview 块）
    openedThisLaunch: Set<string>;
    activeTabId: string | null;
    hideUnopenedTabs: boolean;
    agentsOnly: boolean;
}): OverviewTabGroup[]
```

判定顺序（每 Tab）：
1. `tab == null` → `loading`（骨架）。
2. `可展示块数 === 0`（blockids 空或仅 Overview 块）→ `empty`。
3. `!openedThisLaunch.has(tabId) && tabId !== activeTabId` → `unopened`（灰行，blocks 仍填，
   折叠态下不渲染行）。
4. 其余 → `live`。

过滤规则（在返回数组上，**不减少组**）：
- `hideUnopenedTabs === true` → 剔除 `unopened` 组（这是它唯一的删组权力）。
- `agentsOnly === true` → 不删任何组；调用方渲染时组内行过滤为 agent-like，
  组头徽章显示 `0 agents`（若全滤空）。
- `loading` 与 `empty` 组对两个过滤器都免疫。

单测（`overview-tab-groups.test.ts`，纯 vitest）：4 状态 × {`hideUnopenedTabs`, `agentsOnly`} ×
当前 Tab/非当前 Tab，≥ 12 个用例；特别断言「agentsOnly 开后组数不变」「仅含 Overview 块的 Tab
存在且 empty」。

## 4. 渲染改动（`session-overview.tsx`）

- `useOverviewBlocks` 内部追加 prime 副作用（§2），返回值语义不变（继续不含 sessionoverview 块）。
- `displayedTabGroups` 的三段 filter/map 全部替换为 `buildTabGroups(...)` 输出；
  **删除** `blocks.length > 0` 过滤与 `agentsOnly` 的组级 filter。
- `OverviewTabGroup` 组件（`:2079`）扩状态：
  - `loading` → `div.session-overview-tab-skeleton`（3 条骨架行）；
  - `empty` → 现有 `noBlocks` 文案（已存在 `:2123`，不用新写）；
  - `unopened` → 组头加 `is-unopened` 类（灰化，沿用 Tab 栏 `unopened-this-launch` 的视觉语言），
    徽章 `未打开 · N 块`；
  - `live` → 不变。
  - `collapsed` 初始值：`live` 用现有折叠记忆；`empty`/`unopened` 默认折叠。
- 汇总行（列表末尾）：`共 {N} Tab（显示 {M}）· {K} 个 agent`，N = tabIds.length，
  M = 渲染组数，K = agentCount 合计。
- 「显示更多」不动（`displayLimitAtom` 管的是消息条数，不掺和）。

## 5. 性能与回归

- `buildTabGroups` 输出 memo 依赖：`[tabIdsKey, tabVersionsKey, blocks, openedKey, activeTabId, 两过滤器]`；
  `tabVersionsKey` 用各 tab.version 串接，避免 prime 回填不触发。
- 骨架行不做布局动画（避免虚拟列表抖动）。
- 回归面：`overview-board` / `overview-timeline` 不改源（它们消费 `useOverviewBlocks`，
  输出 shape 不变）；`npm test -- session-overview` 全量跑。

## 6. i18n 新 key（`session-overview.json`）

```
panel.tabUnopened        "未打开"              （徽章）
panel.tabBlockCount      "{n} 块"             （徽章）
panel.tabAgentsCount     "{n} agents"         （agentsOnly 下 0 的情况）
panel.tabSummary         "共 {tabs} Tab（显示 {shown}）· {agents} 个 agent"
panel.tabLoading         "加载中"             （骨架 aria）
```

## 7. 回滚

全部改动集中在一个渲染面板 + 一个纯函数模块 + wos 一个导出函数；`git revert` 单 commit 即回滚。
`primeWaveObjects` 只写缓存不改服务端状态。
