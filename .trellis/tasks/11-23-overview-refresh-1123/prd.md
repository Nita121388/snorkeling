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

---

## 2026-11-24 增量：S3 变体「切回旧 Tab 后悬浮卡丢 agent」已修（未提交）

用户复现（11-24 上午）：Tab a → Tab b（内建 pi agent）→ Tab c；从 c 悬浮 b 有 agent，切回 a 悬浮 b 就没了。

**定性**（代码级证据，非猜测）：
- 每个 Tab 是独立 renderer（`emain/emain-tabview.ts` WaveTabView），悬浮卡读**本 renderer 的 WOS 缓存**；
  c 的 renderer 是 agent 建好之后才创建的（首拉就是新数据），a 的 renderer 是启动时建的（靠广播续命）——
  症状与「a 漏了建块时刻的广播」完全一致。
- 读路径三处实锤缺陷（红证坐实）：迟到 `GetObject` 回 `null` 会抹掉已有值；请求失败永久 `loading:true`
  且不可重试；`reloadWaveObject` 无 version guard 可被旧快照回退。响应式修复（11-20）救不了「事件没到」。

**修复**（未 commit，文件清单见 implement 纪要）：
1. `frontend/app/store/wos.ts`：三条 guard（null 不抹值 / 失败解除 loading 保留值 / reload 同 version guard），
   `primeWaveObjects` 增加 `{force:true}` 对账语义。
2. `frontend/app/tab/tab-card-reconcile.ts`（新增）：卡片打开时重对账（reload tab → 最新 blockids 整批 force prime），
   2s 节流 + 吞错，执行器可注入。
3. `frontend/app/tab/tab-info-card.tsx`：mount（==打开）时触发对账。

**判据（已跑）**：`wos-guards.test.ts`(5) + `tab-card-reconcile.test.ts`(5) + `tab-info-card.dom.test.tsx`(7，含用户症状级回归) 全绿；
旧代码下 5 条红（含 dom 级「陈旧 tab 对象 → 对账后 agent 行出现」）。回归：store/tab/wave 229 + agent-status 177 全绿；tsc 58 = 基线不增。
`wos-prime.test.ts`「超过 400 分批」改用独立 id 段（旧用例隐性依赖「失败后永久 loading」这个 bug）。

**未做**：S1/S2（Overview 不刷新）未在本增量里修——同一病根（跨 renderer 数据不回拉），但 Overview 面
按 PRD 是独立判据，待单独走（可复用 reconcile 范式）。真机 verify 台（tab-info-card-freshness）待复跑。
