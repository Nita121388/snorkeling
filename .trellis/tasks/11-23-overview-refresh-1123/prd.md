# PRD：Overview / Tab 悬浮卡对新增 agent block 不刷新（三症状定根因并修）

> 父：`11-23-session-surface-fixes-1123`（优先级序 2+3，S）。**只有诊断就位后才动代码。**

## 三个症状（同一批用户反馈，2026-11-23）

| # | 症状 | 复现动作 |
|---|---|---|
| S1 | 恢复的会话在 Overview 看板没卡 | 打开 sessions Tab → 恢复一个会话（如本会话 pi）→ 看 Overview 看板 |
| S2 | Tab 里**新增**的 agent 在 Overview 看不到 | 在已开的 Tab 里新增 agent block → 看 Overview（列表 + 看板） |
| S3 | 激活 Tab 的悬浮卡看不到后加的 agent | Tab A 激活 → 在 A 里新增 agent block → hover A 的 Tab 卡 |

## 已知数据事实（不要再查一遍）

- 同一 window、同一 workspace `07361d21`；本会话块 `64c909ed`(term/pi) 在 tab `sessions`(e30485e2)，
  Overview 块 `d0036db6` 在 tab `OverView`(ea409e02) —— **数据层具备显示条件**。
- Overview 数据流：`useOverviewBlocks(workspace)` → `buildTabGroups` → 列/看板卡（P0 包已 tab-first 化）。
- 悬浮卡数据流：`getTabCardDataAtom(tabId, workspaceId)`（已响应式，`frontend/app/tab/tab-info-card.tsx:100`）。

## 待证伪的假设（按可能性排序）

| H | 假设 | 检验点 |
|---|---|---|
| H1 | `useOverviewBlocks` 的 `useMemo` 键是 `[workspace.oid, tabIdsKey, locale]`——**新增块不改 tabIds**，若 atom 未被重算则永不出卡 | 在 atom 里打点/单测：改 tab.version 后派生值是否变 |
| H2 | 新块 `getWaveObjectAtom(block:new)` 首读 null 且 fetch 未触发（prime 只覆盖首帧集合） | 观察 `WOS.primeWaveObjects` 调用集合是否含新块 id |
| H3 | 悬浮卡在 hover 打开期间 latch（不重订阅） | hover 期间新增块 → 卡片是否变化 |
| H4 | 用户看的不是 `OverView` tab（视图错位，非 bug） | 复现台直接断言 DOM，排除人眼因素 |

## 验收判据

- 复现台（新 area `overview-refresh`）三条独立断言：
  1. `add-block-live-tab` → Overview 列表/看板 2s 内出现该块（计数 +1）；
  2. `restored-session-appears` → 恢复会话后 2s 内出卡；
  3. `tab-card-refresh` → hover 卡片 2s 内出现新 agent 行。
  修复前：至少一条红（红证入 `loop/red/`）；修复后 3/3 绿。
- 单测：针对定性出的根因补一条回归（如派生 atom 在 tab.version 变化后重算）。

## 不做

- 不在本包做重构成（融合卡在 `11-23-session-card-unify`）。
- 不改 AISessions 视图的数据流。
