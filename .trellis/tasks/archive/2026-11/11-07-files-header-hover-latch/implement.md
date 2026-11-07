# Implement · Files Block Header 锁存式分区

> 判据来源：`prd.md` §5 A1–A8。每条 checklist 都写「命令 → 期望输出」，写不出就不算完成。

## 阶段 0 · 前置核查（不动代码）

- [ ] **0.1 确认 `schema/settings.json` / `gotypes.d.ts` 是产物**
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; node scripts/run-task.mjs generate"
  git diff --stat schema/settings.json frontend/types/gotypes.d.ts
  ```
  期望：**无 diff**（说明当前产物与源同步）。若有 diff → 先 commit 产物，再开工。

- [ ] **0.2 确认 React 指针事件顺序**（FROZEN 依赖它） —— **已完成，结论已写回 design.md §3.2**
  实测（`verify-runs/_probe/order2.*`）：菜单 portal 到 body、与 header 互为兄弟时，顺序为
  `hdr:pointerenter` → **`hdr:pointerleave related=DIV`** → `menu:pointerenter related=hdr`。
  **header 的 leave 先到**，所以主路径改为在 `onPointerLeave` 查 `relatedTarget` 是否在菜单/浮层内；
  `FREEZE` 取消定时器作为第二层防护。实现时两层都要，并在单测里覆盖 `graceMs=0` 边界（那时只有第一层有效）。

- [x] **0.3 确认 `ConnectionButton` 能否进 `.left-zone`** —— **已完成**
  `frontend/app/block/connectionbutton.tsx` 是 `React.memo(forwardRef)` 普通 flex 节点，
  `block.scss:442` 的 `.connection-button` 为 `display:flex`、无 `position:absolute`，只有子元素
  `.connecting-svg` 用 `position:relative`（不影响父层参与 flex 预算）。
  **结论：可以放进 `.left-zone`**，让位时一起收敛。仍需在阶段 4.2 真机确认让位后不错位。

- [ ] **0.4 基线数字**（写进 report，用于对比）
  ```
  命令：node scripts/inspect-electron-ui.mjs elements --limit 40  （悬浮 header 后）
  记录：240px 宽下 header 内可见 .wave-iconbutton 数、被切数
  期望基线：可见 0 / 被切 6（对齐 PRD §1 实测）
  ```

## 阶段 1 · 纯函数层（无 UI 风险，先绿）

- [ ] **1.1 新增 `frontend/app/block/header-hover-latch.ts`**
  按 design.md §3.1 逐字实现 `reduceHoverLatch` + 类型。**不 import 任何 DOM / React**。
  判据：`npx tsc --noEmit` 通过。

- [ ] **1.2 新增 `frontend/app/block/header-icon-plan.ts`**
  `tierFor` / `planHeaderIcons` / 常量 / `HeaderIconScene` 类型。纯函数，无 DOM。

- [ ] **1.3 单测 `frontend/app/block/header-hover-latch.test.ts`**
  ```
  命令：npx vitest run frontend/app/block/header-hover-latch.test.ts
  期望：全绿。用例必须覆盖 A2 全部：
    - ENTER(left) → zone=left
    - ENTER 后再 ENTER（任意 x）→ 方向不变
    - 100 次连续「x 变化但只有 ENTER 事件不派发」等价断言：reduce 对同一 state 反复 ENTER 不翻转
    - LEAVE → pendingReset=true
    - LEAVE 后 RESET → zone=null
    - LEAVE 后 ENTER（另一侧 x）→ 方向不变 + pendingReset=false   ← 宽限语义
    - FREEZE 后 LEAVE → pendingReset 保持 false
    - FREEZE 后 RESET → 仍是 frozen，zone 不变
    - UNFREEZE → 全归 NEUTRAL
    - 类型层：HoverLatchEvent 无 "MOVE" 分支（用 exhaustive switch 的 never 断言）
  ```

- [ ] **1.4 单测 `frontend/app/block/header-icon-plan.test.ts`**
  ```
  命令：npx vitest run frontend/app/block/header-icon-plan.test.ts
  期望：全绿。必须覆盖 A1：
    - for w in 40..900 step 2, for zone in [left, right]:
        plan = planHeaderIcons(w, zone, markdownScene)
        expect(plan.shown.length + plan.hidden.length).toBe(markdownScene.total)
    - 同一循环断言：plan.mode === "flyout" 时 plan.shown.length === 0 且 hidden.length === total
    - tierFor 边界：w=40→4, 88→3, 192→2, 240→1, 340→0
    - neverOverflow：任何 w 下 "dots"/"vcs"/"close" 若在 shown 之外必须在 hidden，且不得出现「既不在 shown 也不在 hidden」
  ```

## 阶段 2 · 类型层（零行为变化）

- [ ] **2.1 `IconButtonDecl` 扩展**（`frontend/types/custom.d.ts`）
  `zone` 加 `"start"`；新增 `priority?: number`、`neverOverflow?: boolean`。
  判据：`npx tsc --noEmit` 通过；`git grep -n "zone: \"reveal\"" frontend/ | wc -l` 不变（无既有调用点被改）。

- [ ] **2.2 `ViewModel` 加 `startIconButtons`**（`frontend/types/custom.d.ts`）
  判据：`npx tsc --noEmit` 通过。

- [ ] **2.3 既有测试不回归**
  ```
  命令：npx vitest run frontend/app/block/
  期望：全绿（现有 blockframe-header.menu.test.ts / blockutil.test.tsx 等）
  ```

## 阶段 3 · 接线（`blockframe-header.tsx`）

- [ ] **3.1 新增 `useHeaderHoverLatch` hook**（同文件内或独立文件）
  按 design.md §3.2。读 `block:headerhoverlatch` / `block:headerhovergrace` 设置。
  **不加 `onPointerMove`**。

- [ ] **3.2 `data-latched` / `data-tier` 上 header 根节点**
  判据：真机悬浮左右半，`node scripts/inspect-electron-ui.mjs elements --limit 40` 能看到 `data-latched` 在 left/right/空之间按规则变化。

- [ ] **3.3 `.left-zone` 包裹**
  包住 `preIconButton + iconview + ConnectionButton + HeaderTextElems`（ConnectionButton 取决于 0.3 结论）。
  判据：真机 header 视觉无变化（中性态与改动前截图逐像素对比，允许 ≤1px 位移）。

- [ ] **3.4 分组容器**
  `HeaderEndIcons` 内部拆成 `.grp-right`（reveal）与 `.pinned`；`startIconButtons` 渲染进 `.grp-left`。
  **保留 `.is-hovered` class 输出**（fallback 用）。
  判据：`block:headersplitreveal=false` 时真机行为与改动前**完全一致**（悬浮即全展开）。

## 阶段 4 · CSS（`block.scss`）

- [ ] **4.1 新增分区段落**（design.md §4.2），**不改既有 598–640 那段**。
  判据：`git diff frontend/app/block/block.scss` 只有新增行（除必要的选择器调整）。

- [ ] **4.2 让位过渡**
  判据：右锁时 `.left-zone` 宽度收敛、chevron + 路径不可见、类型图标仍在；`transition` 无跳变（真机截图两帧）。

- [ ] **4.3 tier 3/4 CSS**
  判据：40px 块宽下 header 只剩类型图标；点击后浮层出现全部 icon。

## 阶段 5 · `preview-model.tsx` 迁移

- [ ] **5.1 新增 `startIconButtons` atom**，迁 5 个：列表树切换 / 打开方向 / HTML 方式 / Preview / 滚动同步。
  **`Go to Path` 留在 `preview-filename-shell`**（design.md §5.3 决策）。
  判据：真机悬浮左半，这 5 个 icon 出现在**左组**位置；`Go to Path` 仍随文件名 hover 浮现。

- [ ] **5.2 `viewText` 精简**
  判据：`npx tsc --noEmit` 通过；真机路径文本仍在（`copytext` 未动）。

## 阶段 6 · 溢出菜单 + 浮层

- [ ] **6.1 溢出菜单**：点 `…` → 列出 `plan.hidden` 按 LEFT/RIGHT/PINNED 分组。
  判据：菜单项数 === `plan.hidden.length`；点任一项触发原 `IconButtonDecl.click`。

- [ ] **6.2 tier4 浮层**：点类型图标 → 横向工具条铺开全部 icon。
  判据：40px 下浮层项数 === total。

- [ ] **6.3 FROZEN 接线**
  判据：菜单打开时移出 header，`data-latched` 不变；点外侧关闭后回 `NEUTRAL`。

## 阶段 7 · 设置项（三源 + 生成 + 一手改）

- [ ] **7.1 改三个源文件**：`pkg/wconfig/metaconsts.go`、`pkg/wconfig/settingsconfig.go`、`pkg/wconfig/defaultconfig/settings.json`。

- [ ] **7.2 手改 `frontend/app/block/blockenv.ts`** 的 `getSettingsKeyAtom` 联合类型。

- [ ] **7.3 跑生成**
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; node scripts/run-task.mjs generate"
  git diff --stat schema/settings.json frontend/types/gotypes.d.ts
  ```
  期望：两个产物 diff **只含这 5 个 key**（用 `git diff` 逐行确认，多一个 key 就是生成链有副作用，要查）。

- [ ] **7.4 开关生效验证**
  判据：改 `~/.config/snorkeling/settings.json` 里 `block:headersplitreveal=false` → 重启 → 悬浮即全展开（旧行为）。

## 阶段 8 · 真机验证台

- [ ] **8.1 建 `scripts/verify/header-hover-latch/verify.mjs`**（复制 `_template`）
  只从 `../lib/` 拿能力。

- [ ] **8.2 实现 A3–A7 七条断言**（design.md §8 表）

- [ ] **8.3 跑**
  ```
  命令：node scripts/verify/header-hover-latch/verify.mjs
  期望：exit 0，report.md 全 PASS
  ```

- [ ] **8.4 台账**
  ```
  命令：node scripts/verify/index.mjs --json --area header-hover-latch
  期望：看到该 area 一行 ✅ n/n
  ```

- [ ] **8.5 登记到 `scripts/verify/README.md` 的 area 表**

## 阶段 9 · 收口

- [ ] **9.1 全量回归**
  ```
  命令：node scripts/verify/index.mjs --strict
  期望：exit 0（含 aisessions / preview-edit / vcs-* 等既有 area）
  ```

- [ ] **9.2 存量面人工确认**
  `term` block（`useTermHeader`）、`aisessions` block、`vcs` 面板 header：icon 数量与点击行为不变。

- [ ] **9.3 `npx tsc --noEmit` + `npm run lint`**

- [ ] **9.4 回写 spec**
  把「header 分区必须锁存、`pointermove` 不参与分区」写进
  `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md`（硬约束）
  + `docs/project/ui-verify-playbook.md`（若踩到新坑）。

- [ ] **9.5 commit**（一个 commit，含阶段 1–8）

## 回滚点

| 阶段 | 回滚动作 |
|---|---|
| 1 | 删两个新文件 + 两个测试，零影响 |
| 2 | revert `custom.d.ts` |
| 3–6 | revert `blockframe-header.tsx` + `block.scss` + `preview-model.tsx`；运行期用 `block:headersplitreveal=false` 兜底 |
| 7 | revert 三源文件 + 重跑 generate |

## 风险与处置

| 风险 | 触发条件 | 处置 |
|---|---|---|
| `ConnectionButton` 定位冲突 | 0.3 发现非 static 定位 | 移出 `.left-zone`，让位时不动它 |
| 菜单 `pointerenter` 晚于 header `pointerleave` | 0.2 验证为反序 | header `onPointerLeave` 里查 `relatedTarget` 是否在菜单内 |
| `aisessions` `auto-refresh` 宽度 `auto` 估算偏小 | 溢出实测 | `plan()` 的 slot 宽度改成「decl 实测宽度」而非固定 26px；或给该 decl 显式 `priority` 并单独按 32px 估 |
| `schema` / `gotypes` 生成多余 diff | 7.3 | 停手排查生成链，不要手改产物覆盖 |
| 让位过渡导致 focus 链断 | 4.2 | `max-width:0` + `visibility` 而非 `display:none` |
