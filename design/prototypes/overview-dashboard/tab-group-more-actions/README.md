# Overview Tab 展示：打开区 / 更多区（替代「本次打开的 Tab」过滤按钮）

> 同步状态：▲ 设计活跃（未实现，等 nita 拍板）
> 镜像源：frontend/app/session-overview/session-overview.tsx（工具栏 `hideUnopenedTabs` 按钮 + 列表渲染）, frontend/app/session-overview/overview-tab-groups.ts（`buildTabGroups` 四状态）, frontend/app/session-overview/session-overview-model.ts（`hideUnopenedTabsAtom` 持久化）, frontend/app/tab/tab-more-menu.tsx, frontend/app/tab/tab-more-model.ts, frontend/app/tab/tab-collapse-state.ts, frontend/app/tab/tabcontextmenu.ts, emain/tab-collapse-store.ts
> 最后同步：2026-11-24

入口：`index.html`（单文件，双击即可，无依赖）。自检开关：`?view=list|board|timeline` 直切视图，`?seg=1` 默认展开「更多」区，`?ctx=1` 自动展开右键菜单，`?more=1` 自动展开 Tab 栏「更多」下拉。

---

## 需求澄清（nita 两轮修正）

1. 初版：> 希望 Overview 中 Tab 标签 支持右键收藏到更多 和查看更多
2. 修正：> 我的意思是 右上角有个「本次打开的 Tab」这个筛选功能 实际上存在问题，应该区分为**打开的和收藏的更多的** 也就是**默认不展示的**

所以本包的核心不是「加个右键菜单」，而是**改 Overview 的 Tab 展示模型**：把「一刀切过滤」换成「打开区 / 更多区」两桶。

## 现状代码事实

| 项 | 现状 |
|---|---|
| 工具栏按钮 | `.session-overview-filter-button`「本次打开的 Tab」→ `overviewModel.setHideUnopenedTabs()`，文案 key `session-overview:panel.openedTabs` / `panel.hideUnopened` |
| 持久化 | `snorkeling:session-overview:hide-unopened-tabs`（localStorage boolean） |
| 判定 | `buildTabGroups`：`unopened = !openedThisLaunch.has(tabId) && tabId !== activeTabId`；`hideUnopenedTabs === true` 时 `groups.filter(g => g.status !== "unopened")` —— **直接从结果里删掉** |
| Tab 栏侧 | `collapsedTabIds`（主进程真源 + `userData/tab-collapse.json`）决定 Tab 在栏里还是「更多」下拉里 |
| 收藏 | **完全没有**（最接近的是 `tab:flagcolor` 旗标色、`tab-pinned-order` 的自动 pinned，都不是用户收藏） |

## 三个问题（为什么必须改）

1. **一刀切隐藏、无入口**：打开过滤后，未打开的组从 DOM 消失，用户不知道藏了几个、也回不去。
2. **两套隐藏体系口径不同**：Tab 栏用 `collapsedTabIds`（手动收起 + 未打开），Overview 用 `openedThisLaunch`（只认本次启动）；同一个 Tab 两个面命运不同。
3. **没有「这是我关心的」这一维**：未打开的 Tab 里可能是用户特意留着、或 agent 还在跑的项目，现在只能被当成噪音。

## 新方案：分区模型

列表视图分两段（**不再有过滤按钮**）：

```
┌ 打开的 Tab   [4]  本次启动打开过 / 当前激活
│   ├ PPT 组头（右键菜单）
│   ├ aisessions 组头
│   ├ Files 组头
│   └ 日志 组头
│
└ ▶ 更多 Tab  [3]  ★ 收藏 1 · 未打开 2      ← 默认折叠成一行入口
     （展开后）VCS（未打开）· commontext（未打开）· hero:studio（★ 已收藏）
```

**归属规则（互斥、可判定）**

| 条件 | 归属 | 视觉 |
|---|---|---|
| `starred`（用户显式收藏） | 更多区 | ★ 已收藏 徽标，**不置灰**（是主动选择） |
| `!openedThisLaunch && !active`（本次启动未打开） | 更多区 | 未打开 徽标，组体置灰 |
| 其余 | 打开区 | 无徽标 |

收藏优先级最高：即使本次启动打开过，收藏后也进更多区（= 用户说「默认不展示」）。

**与 Tab 栏的同一意图**

- 右键组头「收藏到「更多」」= `tab:starred` meta + `collapseTabIds([id])`（复用现有收起通道）
- Tab 栏「更多」下拉新增分区：`★ 已收藏` → `本次启动未打开` → `已收起`
- 「查看更多」= 展开 Overview 的「更多」区并滚动高亮该 Tab（不跳到 Tab 栏，避免跨面跳转）

## 三视图影响

| 视图 | 是否改 | 说明 |
|---|---|---|
| 列表 | ✅ 改 | 分区模型 + 组头右键 + 旧过滤按钮删除（key 迁移成「更多区展开态」初值） |
| 看板 | ◐ 小改 | 按 Tab 分组的列头接同一菜单 builder；不补空列（`groupOverviewCardsByTab` 行为不变） |
| 时间轴 | ❌ 不改 | 行是块级，无 Tab 维度 |

## 落地锚点

| # | 改动 | 文件 |
|---|---|---|
| ① | `buildTabGroups` 输出加 `bucket: "open" \| "more"` 与 `starred`，删除「删组」路径（组永不消失，只换桶） | `overview-tab-groups.ts` |
| ② | 列表分两段渲染 + 「更多区」折叠入口行（计数 = 收藏 n + 未打开 m） | `session-overview.tsx` |
| ③ | 删除工具栏「本次打开的 Tab」按钮；`hideUnopenedTabsAtom` 存 key 迁移为「更多区展开态」 | `session-overview.tsx` + `session-overview-model.ts` |
| ④ | 新 `buildOverviewTabContextMenu()`（打开 Tab / 收藏 / 查看「更多」区 / 重命名 / 复制 ID / 关闭） | 新增文件 + `session-overview.tsx` |
| ⑤ | 收藏存储：Tab meta `tab:starred`（`SetMetaCommand`，零新 IPC） | `tabcontextmenu.ts` 复用 / 新 util |
| ⑥ | Tab 栏「更多」下拉分区 + 已收藏星标 | `tab-more-model.ts` + `tab-more-menu.tsx` |
| ⑦ | 看板「按 Tab」列头右键接同一 builder | `overview-board.tsx` |

## 判据（实现后怎么算通过）

- 单测 `buildTabGroups`：`starred` → `bucket: "more"`；`openedThisLaunch` 且未收藏 → `"open"`；未打开未收藏 → `"more"`；**任何输入下返回组数 === tabIds 数量**（组永不消失）。
- 单测：`starred` + 本次启动打开过 → 仍在 `more` 桶（收藏优先级）。
- 单测 `buildTabMoreRows`：分区顺序 `已收藏 → 未打开 → 已收起`。
- 单测 `buildOverviewTabContextMenu`：`starred=false/true` 两态菜单项与 enabled。
- 单测回归：`groupOverviewCardsByTab` 仍不补空列。
- 真机：默认只看到打开区 + 一行「更多 Tab」；点开可见收藏与未打开；右键收藏后组立刻掉进更多区且 Tab 栏同步收进 ⋯；重启后仍在更多区（`tab:starred` 持久）。

## 待拍板

- **D1 分区归属**：推荐 `starred` 或 `!openedThisLaunch` → 更多区，收藏优先。
- **D2 旧过滤按钮**：推荐删除（职责被「更多」区折叠接管），不做第二态。
- **D3 更多区展开态**：推荐持久化，旧 key `hide-unopened-tabs` 迁移成初值（true → 展开）。
- **D4 收藏存储**：推荐 B = Tab meta `tab:starred`（A = 扩 `tab-collapse-store`，需新 IPC 链）。
- **D5 「查看更多」目标**：推荐展开 Overview 更多区并高亮（不跨面跳 Tab 栏）。
- **D6 看板是否也分区**：推荐不分区（看板按 Tab 分组本来只显示有卡的列），只接右键菜单。

## 与原型差异（实现时需注意）

- 真实组头还有 flag 颜色、badges、`AggregateStatusChip`、`SessionOverviewBadgeIcon`；原型只保留数量 + 状态徽标。
- 真实「更多」下拉有搜索框（`shouldShowTabMoreSearch`）与 info-card 悬浮卡。
- 真实的 `openedThisLaunch` 由主进程广播（`openedThisLaunchTabIdsAtom`）；原型是本地模拟。
