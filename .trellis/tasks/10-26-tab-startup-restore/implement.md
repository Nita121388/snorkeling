# 执行计划：Tab 栏启动还原 + 溢出「更多」

> 状态：planning。**本任务当前只落文档，`task.py start` 后才进入 Phase 2。**
> 需求与验收见 `prd.md`；技术设计与算法见 `design.md`。
> **首片 = 片 0（启动恢复全部 Tab），只交付 R1；片 1–4 随后续片交付，每片单独过门。**

## 前置

```bash
cd /Users/nita/Primary/projects/snorkeling

# 1) 读懂现状
sed -n '250,460p' frontend/app/tab/tabbar.tsx      # visibleTabIds / setSizeAndPosition / scrollbar
sed -n '210,470p' frontend/app/tab/vtabbar.tsx     # visibilityCtx / renderOrderedTabIds
cat frontend/app/tab/tab-more-model.ts
cat frontend/app/tab/tab-more-menu.tsx
sed -n '1840,1900p' frontend/app/block/block.scss  # inline-tab-block-more-btn 视觉基线

# 2) 确认物理顺序 / 激活来源（不改，只确认）
grep -n "activetabid" emain/emain-window.ts | head
grep -n "ActiveTabId\|TabIds" pkg/wcore/workspace.go | head

# 3) 工作区状态
git status --short
```

### 开工前置条件（硬性）

- [ ] 已检查 `10-26-tab-more-agent-card` 已归档，且当前工作区/分支没有对 `tab-more-menu.tsx` / `tab-more-model.ts` 的并行未提交改动。
- [ ] 工作区无与本任务无关的未提交改动（原先的 `commontext-compose-modal.tsx` / `loop/LEDGER` 改动已由用户提交 `7a73cbd2a`；取件前重新 `git status` 确认只剩本任务改动）。
- [ ] 用户已确认 PRD 契约（尤其首片 R1 全量可见，及 A 方案：窗口从 `tabids[0]` 起，不平移）。

---

## 片 0：启动恢复全部 Tab（首片 · 本次交付，只做 R1）

**改动面**：`emain/emain-window.ts`、`emain/emain-window.test.ts`、新增 `scripts/verify/tab-startup-restore/`、`scripts/verify/README.md` 登记。

- [x] 0.1 `createBrowserWindow`（`emain/emain-window.ts:935`）：取到 workspace 后、`setActiveTab(workspace.activetabid)` 前，把 `workspace.tabids` 逐个 `markTabOpenedThisLaunch(tabId)`（抽小函数便于测试；见 `design.md` §2.5 时机与覆盖）。（完成：commit 874b5ec9f）
- [x] 0.2 导出 `getOpenedThisLaunchTabIds`（或等价测试缝），`emain/emain-window.test.ts` 新增用例：恢复标记后集合含全部 tabids、重复调用幂等、`tabids` 为空/undefined 不炸。（完成：红 2 failed → 绿 4 passed）
- [x] 0.3 单测回归：`npx vitest run emain/emain-window.test.ts frontend/app/tab/`（91 passed）。（完成）
- [ ] 0.4 真机验证台已建（`scripts/verify/tab-startup-restore/verify.mjs`，播种 5 Tab → 同 profile 重启 → 断言数量/顺序/激活/无灰化）；**本机 Electron 启动器环境阻塞**（dev 实例 tabview init 实测 3~4 分钟，两次 fatal，见 verify-ledger 06:17/06:34 行），待环境空闲补跑。
- [ ] 0.5 水平/垂直栏各跑一遍 0.4（随 0.4 一起待补）。

**验收**（对应 PRD「首片」验收清单）
- 5 Tab 重启 → 主栏 5 个全显示、顺序一致、激活一致、不灰、「更多」计数 0（水平 + 垂直）。
- 会话内行为不回退：新建 / 切换 / 重命名 / 右键 / 关闭 / 搜索过滤 / 「收起未使用」照旧。
- `npx tsc --noEmit` 错误数 ≤ 基线 47。

**审查门 G0**：0.3 单测绿 + 0.4 验证台退出码 0 + `git diff --name-only` 只含本片白名单（`emain/**`、`scripts/verify/**`）→ 贴证据给用户，确认后才进片 1。（状态：单测/queue prove 绿；真机台待环境补跑，G7 人工确认）

---

## 片 0.5：拖拽误判 + 切换响应（R8/R9，2026-11-14 用户确认）

**改动面**：`frontend/app/tab/tab-drag-model.ts(+test)`、`frontend/app/tab/tab-optimistic-active.ts(+test)`、`tabbar.tsx`、`vtabbar.tsx`、`emain/emain-window.ts(+test)`、`emain/emain.ts`。

- [x] 0.5.1 R8 拖拽：engage = 8px（按 zoomFactor 折算）× 连续 2 次 mousemove；落点用 mousedown 实时 rect 快照（tabId → 位置）；拖拽只在 `workingOrder` 副本上换位，mouseup ≥50px 才 `setTabIds` + 落盘；方向状态入 ref；删除 `dragStartPositions` state / `saveTabsPosition` / 模块级 `prevDelta`。
- [x] 0.5.2 R9.1 乐观高亮：`tab-optimistic-active.ts`（2s 安全超时）；两栏 Tab `active` 视觉 prop 用 highlight，非视觉逻辑仍用 `staticTabId`；后端确认后清除。
- [x] 0.5.3 R9.2 双入队去重：`WaveBrowserWindow.isTabSwitchInFlight` + `emain.ts` updateactivetab 处理器去重。
- [x] 0.5.4 单测：`tab-drag-model.test.ts`（10 例）/ `tab-optimistic-active.test.ts`（5 例）/ `emain-window.test.ts`（+2 例）；红证 = 修复前两文件 ERR_MODULE_NOT_FOUND；绿证 21 passed；`frontend/app/tab/` 全套 102 passed；tsc 47 = 基线。
- [ ] 0.5.5 手动回归（G7）：快速点击不换位；微拖 5–9px 不跟随不换位；真拖 ≥50px 才换位并落盘；点击后高亮立即跟随。
- [ ] 0.5.6 后续片（拿 `[tabswitch]` 日志数据后）：队列感知最新意图 / 已加载 Tab 插队（C）；`reinitWave` 减负（D）。

---

## 片 1：触发器换 block 同款三点（零逻辑）

**改动面**：`tab-more-menu.tsx`（仅 trigger 的 JSX / className）。

- [ ] 1.1 `fa fa-solid fa-layer-group` → `makeIconClass("ellipsis", true)`。
- [ ] 1.2 删除垂直栏 `variant === "vertical"` 的「更多」文字 `<span>`；`title` / `aria-label` 承接语义。
- [ ] 1.3 计数徽标保留：`hiddenCount > 0` 显示数字（10px，对齐 block `.more-count`）；`0` 时不显示数字。
- [ ] 1.4 触发器常驻：`hiddenCount === 0` 时降 `opacity`（不隐藏），保证「收起未使用 / 新建 Tab」入口可达。
- [ ] 1.5 对齐 block 基线：height / padding / radius / hover 视觉与 `inline-tab-block-more-btn` 一致（垂直栏允许尺寸不同，图标一致）。

**验收**
- 水平栏 + 垂直栏均显示 `⋯`，无「更多」二字。
- 计数正确；计数 0 时半透明可见。
- 打开菜单，搜索 / 点击切 Tab / `✕` / 新建 / 收起 全部照旧。

**审查门 G1**：DOM 测试 `tab-more-menu.dom.test.tsx` 全绿；截图（可选）与 block 药丸并排对比。

---

## 片 2：删除两栏分组重排，改纯物理顺序

**改动面**：`tabbar.tsx`、`vtabbar.tsx`。

- [ ] 2.1 `tabbar.tsx`：删除 `setSizeAndPosition` 里 `visibleTabs` / `hiddenTabs` 分支，`layoutTabIds = visibleTabIds`（物理序）。
- [ ] 2.2 `tabbar.tsx`：`visibleTabIds` 里的 `wasTabOpenedThisLaunch` / `tabsWithUnreadDots` / `headerHovered` 过滤改为「只在窗口切分时决定」（片 3 接管）；片 2 先改为「全部显示」，保证语义可独立验证。
- [ ] 2.3 `vtabbar.tsx`：`renderOrderedTabIds` 恒等于 `orderedTabIds`；删除 `isTabHiddenFromBar` 在渲染路径上的分组用法。
- [ ] 2.4 删除 hover 展开整列的旧逻辑（`isTabBarHovered` / `headerHovered` 不再影响可见性；保留 hover 视觉态）。
- [ ] 2.5 `rg "partitionAndOrderTabs|isPinnedTab" frontend/` 确认零引用后，删除 `tab-pinned-order.ts`（若仍有引用则保留并记为片 4 待办）。

**验收**
- 重启前后顺序一致；把 `E` 拖到最前，重启后仍是 `[E,A,B,C,D]`。
- 激活项 = 关闭前那个。
- 无 Tab 被默认隐藏（此时可能溢出，靠滚动/溢出错位，片 3 收紧）。

**审查门 G2**：手动重启两次截图对比顺序 + 激活；`git diff` 只含两栏 + 可能的删除文件。

---

## 片 3：窗口切分 + 溢出进「更多」+ 手动隐藏持久化

**改动面**：`tab-more-model.ts`、`tabbar.tsx`、`vtabbar.tsx`、`tab-collapse-state.ts`、`tabcontextmenu.ts`、`tab-more-menu.tsx`、Tab 关闭路径、相关单测。

- [ ] 3.1 `tab-collapse-state.ts` 将手动隐藏集合改为可跨 renderer / 重启持久化的 store；单隐藏、批量收起、单项恢复及 Tab 删除清理共用该 store。
- [ ] 3.2 `tabcontextmenu.ts` 为单个 Tab 增加「从 Tab 栏隐藏」；不关闭、不激活、不重排。
- [ ] 3.3 `tab-more-menu.tsx` 为手动隐藏行增加「显示在 Tab 栏」动作，恢复时不激活 Tab；直接打开该行仍沿用自动解除隐藏行为。
- [ ] 3.4 `tab-more-model.ts` 新增 `computeTabBarWindow`（按 `design.md` §3 的算法，手动隐藏先从候选中排除，自动溢出按当前窗口重算）。
- [ ] 3.5 新增 `tab-more-model.test.ts` 用例：
      - 集合守恒：visible 与 hidden 无重复且并集为 tabIds；未隐藏候选内保持物理序前缀
      - 全部放得下 → `hiddenCount === 0`、`visible === tabIds`
      - 放不下 → `1 <= fit <= N-1`，`visible` 是前缀
      - `capacity` 单调增 → `hiddenCount` 单调不增
      - `manuallyHiddenTabIds` 被提前摘出并与自动溢出合并；自动窗口切分不覆盖持久化手动集合
      - store 测试覆盖刷新/重建后读回、跨 renderer storage 同步、单项恢复、打开时自动展开、删除时清理
- [ ] 3.6 `tabbar.tsx`：
      - `visibleTabIds = win.visibleTabIds`，`idealTabWidth = win.itemSize`（不再按 pinned 分组算基数）
      - 删除 `OverlayScrollbars` 创建/销毁与 `scrollableRef` 相关分支
      - `moreBtnWidth` 计入 `spaceForTabs`；`ResizeObserver` 只在容器尺寸变化时重算（避免自激）
- [ ] 3.7 `vtabbar.tsx`：
      - 可用高 = 容器 `clientHeight`；`computeTabBarWindow` 以行高 36 切分
      - 删除 `overflow-y-auto` 与 `updateScrollFromDragY`；容器 `overflow-hidden`
      - `hidden` 传参改 `!visibleSet.has(tabId)`
- [ ] 3.8 `tab-more-menu.tsx`：
      - `hiddenCount` 取自 `win.hiddenCount`（不再从 rows 二次统计避免口径漂移）
      - 激活项在 `hiddenTabIds` 内 → 触发器 accent；未读在 hidden 内 → 触发器红点
- [ ] 3.9 `tab-more-model.ts`：`isTabHiddenFromBar` 语义收窄为「在 hiddenTabIds 内」，`unopenedThisLaunch` 只做弱化。

**验收**
- 水平 20 Tab / 宽 1200：主栏只显示放得下的前 N 个，**无横向滚动条**，计数 = 自动溢出数 + 手动隐藏数。
- 垂直 20 Tab / 高 700：主栏只显示放得下的前 N 个，**无纵向滚动条**，计数正确（含手动隐藏项）。
- 激活项在窗口外：药丸 accent + tooltip；点菜单内该项可切回并关面板。
- 拖拽重排落点正确，hidden 不参与。

**审查门 G3**：单测全绿；`previews/tabbar.preview.tsx`、`previews/vtabbar.preview.tsx` 增加 20 Tab 溢出示例并可交互。

---

## 片 4：清理死代码 + 全量回归

- [ ] 4.1 `rg "osInstanceRef|OSOptions|scrollableRef|updateScrollFromDragY|scrollIntoView" frontend/app/tab/` 清理残留。
- [ ] 4.2 `rg "partitionAndOrderTabs|isPinnedTab|tab-pinned-order" frontend/` 确认无引用后删除文件。
- [ ] 4.3 `tabRecencyStore` 保留存储与 `tabRecencyBumpAtom`（其他逻辑仍用），注释标明「不再驱动排序」。
- [ ] 4.4 更新 `tab-more-menu.dom.test.tsx` 覆盖新触发器及手动隐藏行的恢复（图标 class / 计数 / 常驻半透明 / 恢复不激活）。
- [ ] 4.5 全量校验：
      ```bash
      npx tsc --noEmit
      npx vitest run frontend/app/tab/
      ```
- [ ] 4.6 手动回归清单：点击切 Tab / 双击重命名 / 右键菜单 / 拖拽重排 / 关闭 Tab / 「收起未使用」/ 单 Tab 隐藏与恢复 / 重启仍隐藏 / 搜索过滤 / `Esc` 关闭 / 重启顺序与激活还原。

**验收**
- 参考 `prd.md` 的「验收标准」逐条打勾。
- `git diff --stat` 只含 `frontend/app/tab/` 与 `frontend/preview/`。

**审查门 G4**：给用户贴验收证据，确认后进入 Phase 3（spec 更新 + commit）。

---

## 提交策略

- 每片一个 commit，消息前缀：
  - `fix(tab): 启动恢复时标记全部已存 Tab，重启后主栏全量可见`（片 0）
  - `feat(tab): 更多触发器换成 block 同款三点`
  - `refactor(tab): 两栏去分组重排，按 tabids 物理序渲染`
  - `feat(tab): 窗口切分填满 + 溢出进更多`
  - `chore(tab): 清理 pinned/滚动死代码 + 回归测试`
- `10-26-tab-more-agent-card` 已归档；开始实施前仍需确认没有后续未提交的同文件改动。

## 待办（明确不在本任务）

- 启动偏好设置（first / last / byRecency）。
- Tab 钉住启动顺序。
- 「更多」行 hover Agent Card（`10-26-tab-more-agent-card`）。
