# 执行计划：Tab 栏启动还原 + 溢出「更多」

> 状态：planning。**本任务当前只落文档，`task.py start` 后才进入 Phase 2。**
> 需求与验收见 `prd.md`；技术设计与算法见 `design.md`。

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

- [ ] `10-26-tab-more-agent-card` 已提交或已确认不再改 `tab-more-menu.tsx` / `tab-more-model.ts`；
      否则本任务片 1/2 与其摘写同一批文件，必须先串行。
- [ ] 工作区无与本任务无关的未提交改动（当前有 annotation / sort-chain 改动，需先清理或隔离）。
- [ ] 用户已确认 PRD 契约（尤其 A 方案：窗口从 `tabids[0]` 起，不平移）。

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

## 片 3：窗口切分 + 溢出进「更多」

**改动面**：`tab-more-model.ts`、`tabbar.tsx`、`vtabbar.tsx`、新增单测。

- [ ] 3.1 `tab-more-model.ts` 新增 `computeTabBarWindow`（按 `design.md` §3 的算法）。
- [ ] 3.2 新增 `tab-more-model.test.ts` 用例：
      - 顺序守恒：`visible ++ hidden === tabIds`
      - 全部放得下 → `hiddenCount === 0`、`visible === tabIds`
      - 放不下 → `1 <= fit <= N-1`，`visible` 是前缀
      - `capacity` 单调增 → `hiddenCount` 单调不增
      - `collapsedTabIds` 被提前摘出并并入 `hiddenTabIds`
- [ ] 3.3 `tabbar.tsx`：
      - `visibleTabIds = win.visibleTabIds`，`idealTabWidth = win.itemSize`（不再按 pinned 分组算基数）
      - 删除 `OverlayScrollbars` 创建/销毁与 `scrollableRef` 相关分支
      - `moreBtnWidth` 计入 `spaceForTabs`；`ResizeObserver` 只在容器尺寸变化时重算（避免自激）
- [ ] 3.4 `vtabbar.tsx`：
      - 可用高 = 容器 `clientHeight`；`computeTabBarWindow` 以行高 36 切分
      - 删除 `overflow-y-auto` 与 `updateScrollFromDragY`；容器 `overflow-hidden`
      - `hidden` 传参改 `!visibleSet.has(tabId)`
- [ ] 3.5 `tab-more-menu.tsx`：
      - `hiddenCount` 取自 `win.hiddenCount`（不再从 rows 二次统计避免口径漂移）
      - 激活项在 `hiddenTabIds` 内 → 触发器 accent；未读在 hidden 内 → 触发器红点
- [ ] 3.6 `tab-more-model.ts`：`isTabHiddenFromBar` 语义收窄为「在 hiddenTabIds 内」，`unopenedThisLaunch` 只做弱化。

**验收**
- 水平 20 Tab / 宽 1200：主栏只显示放得下的前 N 个，**无横向滚动条**，计数 = 20-N。
- 垂直 20 Tab / 高 700：主栏只显示放得下的前 N 个，**无纵向滚动条**，计数正确。
- 激活项在窗口外：药丸 accent + tooltip；点菜单内该项可切回并关面板。
- 拖拽重排落点正确，hidden 不参与。

**审查门 G3**：单测全绿；`previews/tabbar.preview.tsx`、`previews/vtabbar.preview.tsx` 增加 20 Tab 溢出示例并可交互。

---

## 片 4：清理死代码 + 全量回归

- [ ] 4.1 `rg "osInstanceRef|OSOptions|scrollableRef|updateScrollFromDragY|scrollIntoView" frontend/app/tab/` 清理残留。
- [ ] 4.2 `rg "partitionAndOrderTabs|isPinnedTab|tab-pinned-order" frontend/` 确认无引用后删除文件。
- [ ] 4.3 `tabRecencyStore` 保留存储与 `tabRecencyBumpAtom`（其他逻辑仍用），注释标明「不再驱动排序」。
- [ ] 4.4 更新 `tab-more-menu.dom.test.tsx` 适配新触发器（图标 class / 计数 / 常驻半透明）。
- [ ] 4.5 全量校验：
      ```bash
      npx tsc --noEmit
      npx vitest run frontend/app/tab/
      ```
- [ ] 4.6 手动回归清单：点击切 Tab / 双击重命名 / 右键菜单 / 拖拽重排 / 关闭 Tab / 「收起未使用」/ 搜索过滤 / `Esc` 关闭 / 重启还原。

**验收**
- 参考 `prd.md` 的「验收标准」逐条打勾。
- `git diff --stat` 只含 `frontend/app/tab/` 与 `frontend/preview/`。

**审查门 G4**：给用户贴验收证据，确认后进入 Phase 3（spec 更新 + commit）。

---

## 提交策略

- 每片一个 commit，消息前缀：
  - `feat(tab): 更多触发器换成 block 同款三点`
  - `refactor(tab): 两栏去分组重排，按 tabids 物理序渲染`
  - `feat(tab): 窗口切分填满 + 溢出进更多`
  - `chore(tab): 清理 pinned/滚动死代码 + 回归测试`
- 片 1/2 若与 `10-26-tab-more-agent-card` 同文件，**必须 rebase 到其之后**再提交。

## 待办（明确不在本任务）

- 启动偏好设置（first / last / byRecency）。
- Tab 钉住启动顺序。
- 「更多」行 hover Agent Card（`10-26-tab-more-agent-card`）。
