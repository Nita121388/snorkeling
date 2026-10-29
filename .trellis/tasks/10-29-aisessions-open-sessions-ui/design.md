# Design：AISessions 打开的会话查询 + Open 筛选 + Fold 下拉

## 背景

用户希望：① 知道「当前打开的会话」并在列表里区分；② 在筛选方案里新增一个默认的「打开的会话」方案；
③ 把分散的「子代理折叠」「标签行内折叠」收进一个和 SortMenu 同形态的下拉框。

本任务在 `10-29-aisessions-filter-state-persist`（筛选持久化，已提交）之上扩展。
UI 文案一律英文，项目无 i18n。

## 全局 UI 约束（来自 nita 的 10 条原则，逐条落实）

1. **不用中点 `·` 分隔文案**：任何标题、摘要、列都不得出现 `·`。多值用独立行 / 嵌套列表达，不用分隔符拼接。
2. **无冗余解释文本**：不写 `only sessions with an open block` / `smart = auto-expand` / `This session is open in N blocks:` 这类说明句。语义进 `title` / `aria-label`，界面只留控件与必要标签。
3. **文案贴合**：主受众是会用 CLI/agent 的开发者。preset 名用 `Open`（非 `Open Sessions`）；下拉标题不出现，按钮即语义；不造词（`Fold Controls` 之类不出现于界面）。
4. **颜色**：本功能**只用语义 token**（`text-accent` / `text-secondary` / `surface` / `border` …），**禁止硬编码颜色**。Radix Colors 迁移是独立任务，本任务不引入；design 写明「新代码不写死颜色」即可。
5. **光学对齐 / 嵌套同心圆角**：容器 `rounded-xl(12px)` 时，内部卡片用 `rounded-md(8px)` 不同心 → 改为内部 `rounded-[10px]` 让差值为 2px（同心原则：内半径 = 外半径 − 边框到内容间距）。新加的下拉浮层沿用 SortMenu 既有 `rounded-md` 即可（它已是单层浮层）。
6. **边框 0.5px**：用 `box-shadow: inset 0 0 0 0.5px var(--color-border)` 封装为 `hairline` 原子类（非 HiDPI 上 `border:0.5px` 会发虚/取整）。新控件一律用它替代 `border border-border/70`。存量 `border-border/70` 不在本任务清理范围。
7. **动画最少**：必须动时 `ease-out 250ms`。行内 open 标记**完全无过渡**；下拉浮层统一 `duration-250 ease-out`，移除现有的 `duration-150` / `transition-transform`（行展开箭头保留 `transition-transform` 但改 250ms）。
8. **字号 ≤3 种，最小 12px**：新 UI 只用 `text-xs(12)` / `text-[13px]` / `text-sm(14)`。层次靠字重 + `text-secondary`。不引入 10/11px。
9. **减少判断型交互**：① `Open` 不藏进 Presets 子菜单，直接作为 Filter panel 里的一个段（用户设筛选的地方）；② Fold 下拉用分段直选（radio），无 `Apply` 按钮、无说明；③ 头栏的「N open」按钮与 Filter 的 Open 段二选一，删头栏冗余按钮。
10. **圆角/阴影克制**：**禁用行左 2px 彩色竖条**（原则 9 同源违规）；禁用圆角 pill + 阴影；浮层用 `hairline` 描边 + `rounded-md`，不用 `shadow-lg`/`shadow-sm`。

## 架构

### 1. 打开态查询（纯前端，前端权威）

布局树、`hiddenBlockIds`、minimized（`tab.meta`）、InlineTab active 子块、焦点节点，**只有前端 layoutModel 是权威**。后端不可靠（`active`/`focused` 算不准），且本任务不做后端镜像（Step 2 留待独立任务）。

新增：

- `open-sessions.ts`（纯逻辑，不 import jotai/react）：
  - `OpenLevel = "open" | "visible" | "active" | "focused"`
  - `OpenSessionEntry { sessionId, source: "chat"|"agent", connection, cwd, blockId, tabId, level, duplicateBlockIds }`
  - `OpenState = "any" | "open" | "visible" | "active"`（筛选维度）
  - `collectOpenSessionBlocks(get, tabIds)`：复用 `use-sessions-running.ts:collectAgentBlocks` 的形状，chat 块取 `meta["aisessions:sessionid"]`，agent 块取 `resolveAgentSessionIdFromMeta`。
  - `projectOpenSessions(blocks, ctx)`：纯函数，输入全部可 mock（tabsById / workspace.activetabid / hiddenIds / minimizedIds / focusedNodeId / block→layoutData 映射），输出 `Map<sessionId, OpenSessionEntry>`（合并同 session 多块，level 取最高，其余进 duplicateBlockIds）。
  - 级别推导真值表（见 ASCII §E）：block 存在且绑定 sessionId → open；布局可达且非 hidden 且非 minimized → visible；所在 tab == workspace.activetabid → active；是 focusedNode → focused。
- `open-sessions-store.ts`（状态层）：模块级 `atom` + 订阅（wos block/tab/workspace atom + layoutModel 的 `localTreeStateAtom` / `hiddenBlockIds` / `tabAtom`），100ms microtask 合并重算，输出快照对象 identity 稳定（deep-equal 复用旧快照，避免全表重渲）。导出 `useOpenSessions()` / `useSessionOpenLevel(sessionId)`。
- 现有 `use-sessions-running.ts:collectAgentBlocks` 重构为复用 `collectOpenSessionBlocks`（消重）。

边界（必须覆盖的单测）：
- New Chat 占位块（`aisessions:newchat`，无 sessionId）：排除，不进结果。
- 同 session 多块：bySession 1 条 + duplicateBlockIds 长度 N-1。
- 远程块（connection 非空）：sessionId 与本地同 id 不串台，查询带 connection 维度。
- hidden / minimized：open 仍真，visible 假（open 用 `tab.blockids`，visible 再排除 hidden ∪ minimized）。
- 子块 / ephemeral：只统计 `rootnode` 可达叶子，不算 subblockids / ephemeral。
- 跨窗口：`active`/`focused` 仅对本 window 成立；多窗口上报（本任务不做）前，别窗口条目降级为 `visible` 并标 `otherWindow`。

### 2. Open 筛选维度

`filter-presets.ts:FilterPresetFilter` 增加 `openState: OpenState`（默认 `"any"`）。`applyFilterSnapshot` / `captureCurrentFilter` / `parseFilterStateMeta` 同步。

列表过滤：在 `visibleSessions` 派生前插入 open 过滤——若 `openState != "any"`，取 `useOpenSessions()` 的 `bySession` 集合，保留 `level >= openState` 映射到的会话（级别序：open<visible<active，active 包含 focused）。与现有 9 维 AND。

持久化：自动复用 `10-29-filter-state-persist`（写进 block meta 的 `FilterPresetFilter`），`openState` 加进 `filter-state-persist.ts` 的快照与 sanitize。

预置方案 `Open`：在 FilterPresetMenu 顶部加一条 built-in（不可编辑/重命名/删除，无 ✎/⧉/🗑 行内菜单），label `Open`，应用 = `setOpenState("open")`（其余筛选维度保持用户当前值，不强制复位）。该条在 `openState != "any"` 时高亮为 active。这比原 design 里「[⚑ Open ✕] chip」更贴合用户原话「在筛选方案里新增一个默认方案」，且符合第 9 条原则（选择落在用户预期的位置）。

### 3. Fold 下拉（仿 SortMenu 形态）

新 `fold-menu.tsx`，与 `sort-menu.tsx` 同形（受控、localStorage 持久化、不进筛选链）。状态：

- `SubSessionsFold = "folded" | "expanded" | "smart"`：映射现有 `subSessionsOverride`（`null`→folded 语义保持：默认全折叠；smart=命中筛选自动展开）。从内存态升级为持久化偏好（localStorage key `aisessions.subsessionsfold`）。
- `TagsFold = "folded" | "expanded"`：映射现有行内 tags 的 `expandAllTags`（boolean，localStorage 持久化）。原设计稿的 `hover` 三态因底层 `expandAllTags` 仅为布尔、且 hover 展开需额外 row 级 hover 态，本期不做；保持 2 态（Folded = 仅显示前 4 个 tag，Expanded = 显示全部）。

按钮摘要（避开中点）：仅显示主状态 `Folded` / `Expanded` / `Smart`。标签状态不拼进按钮文案（进 `title`）。

Header 排列（原则 9，去掉 §C 的重复头栏按钮）：
`[⚑ Filters ▾] [★ Presets ▾] [⊟ Fold ▾] … [⇅ Sort ▾] ⟳`

### 4. 行内 open 标记（无左色条）

在行尾既有「热力条 ◍ + 大小 ▤」集群**之前**加一个 12px 图标位（open 才出现）：

| level | 图标 | token |
|---|---|---|
| open（非可见）/ visible | 空心方 12px | open=`text-secondary/60`，visible=`text-secondary` |
| active / focused | 实心方 12px | `text-accent` |

无过渡、无圆角、无阴影、不新增列（塞进行尾 flex 集群）。与左侧 `🟢`（进程在跑）正交，不合并。

### 5. 详情头栏多块提示

头栏加 `▣ N`（N=该 session 的打开块数，仅 N>1 显示），hover 出浮层：每行 `图标 + 名称 + 右侧 tab 名`，无中点、无标题句。点击聚焦对应块（沿用 `openAISessionDetailFromList` 的 focus 分支）。

## 验收

1. 同一 tab 开两个详情（InlineTab）→ 查询返回 2 条；active 只标当前子块；切 tab 跟随。
2. minimize / hide 一个块 → open 仍真，visible 假。
3. 同 session 多块 → bySession 1 条 + duplicateBlockIds 长度 N-1。
4. 远程块与本地同 id 不串台。
5. 设 Open 筛选 → 仅显示已打开的会话；切 tab / 重开保留（走持久化）。
6. Fold 下拉直选 3 态生效；Tags 三态生效；持久化跨会话。
7. 打开/关闭 10 块时行内标记重渲次数 ≤ 变化次数（快照 identity 稳定）。
8. `npx vitest run` 相关用例 + `npx tsc --noEmit` 无新增错误（仓库既有 73 个 preview 错误不在范围）。
9. UI 自查：无 `·`、无解释句、字号仅 12/13/14、无左彩色竖条、无 `shadow-lg`、边框走 `hairline`、动画仅下拉 250ms ease-out。

## 不在范围

- 后端 `ListOpenSessions` 镜像（Step 2，独立任务）。
- Radix Colors 迁移（独立任务；本功能只用语义 token）。
- 存量违规清理（10px 字号、中点分隔、shadow-lg、左色条等），单开清理任务。
