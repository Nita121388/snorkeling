# Implement — 路径选择浮窗滚动契约统一

> 执行顺序：先基线 → 再 Terminal/Agent（核心）→ 再 New Files 对齐 → 最后验证。
> 纯布局改动，无后端 / 数据模型 / 配置键参与。

## Step 0 — 前置检查（不改代码）

```bash
git status --short
git log --oneline -1
```

- [ ] 确认起点干净（只有 `.trellis/` 未跟踪）
- [ ] 记录基线提交号（回滚锚点）

**Rollback point R0**：无改动，随时可放弃。

---

## Step 1 — Terminal / Agent 浮窗：根节点 + size middleware

**文件**：`frontend/app/workspace/widgets.tsx`

**改动 A — 根节点骨架**（Agent `:886`，Terminal `:1436`）

```diff
- ... min-w-[400px] max-w-[520px] overflow-visible"
+ ... min-w-[400px] max-w-[520px] flex flex-col overflow-hidden"
```

**改动 B — `size` middleware 的 `apply`**（Agent `:646-654`，Terminal `:1379-1387`）

```diff
- elements.floating.style.maxHeight = `${Math.max(availableHeight, 120)}px`;
- elements.floating.style.overflowY = "auto";
+ elements.floating.style.maxHeight = `${Math.max(Math.min(availableHeight, 640), 120)}px`;
+ elements.floating.style.overflowY = "auto";   // 保留：flex 布局下正常情况不触发，仅作退化兜底
```

> **注意**：内联 `overflowY` **保留** `"auto"`，不是改成 `"hidden"`。
> 根节点改成 flex 列 + 列表 `flex-1 min-h-0` 后，溢出量被列表吸收，
> 根节点正常情况下永远不溢出 → 表现为「整个弹窗不滚」。
> 只有视口矮到 chrome 段（≈200px）都放不下时根才会真的溢出，
> 此时整窗可滚，保证 footer 按钮不被裁掉且仍可达。

**验证**

```bash
grep -n "overflow-visible\|overflowY = \"auto\"\|overflowY = \"hidden\"" frontend/app/workspace/widgets.tsx
```

- [ ] 两处根节点都不再有 `overflow-visible`，均为 `flex flex-col overflow-hidden`
- [ ] 两处 `size` middleware 的 `maxHeight` 都夹了 640 且保留 120 地板
- [ ] 两处 `size` middleware 的 `apply` 仍写 `overflowY = "auto"`（退化兜底，**不是** hidden）
- [ ] `SettingsFloatingWindow`（`:1632`）与 `AppsFloatingWindow`（`:216`）**未被误改**
      （它们的 `size` 行为与本任务无关）

**Rollback point R1**：`git checkout -- frontend/app/workspace/widgets.tsx`

---

## Step 2 — Terminal / Agent 浮窗：路径列表容器

**文件**：`frontend/app/workspace/widgets.tsx`

**改动 C — 路径列表**（Agent `:1117-1200`，Terminal `:1447-1525`）

把 `<div className="px-1 pb-1">` 改为 `flex flex-col min-h-0`，
其中 `Select a path.` 标题（仅 Agent 有）加 `shrink-0`，
并把 `targets.map(...)` / `No paths found` 包进新的滚动容器：

```jsx
<div className="flex-1 min-h-0 overflow-y-auto overscroll-contain max-h-[min(320px,40vh)]">
```

**改动 D — chrome 段 `shrink-0`**

- Agent：header（`:872`）、agent-type 芯片区（`:899`）、vendor 芯片区（`:973`）、
  Pi「启动方式」段（`:1088`）、footer（`:1198`）
- Terminal：header（`:1443`）、footer（`:1519`）

**验证**

```bash
grep -n "overscroll-contain\|max-h-\[min(320px,40vh)\]\|shrink-0" frontend/app/workspace/widgets.tsx
```

- [ ] 两处滚动容器都有 `overflow-y-auto` + `overscroll-contain` + `min-h-0`
- [ ] 两处滚动容器都有 `max-h-[min(320px,40vh)]`
- [ ] chrome 段全部 `shrink-0`
- [ ] JSX 结构闭合正确（`targets.map` 的 `})` 括号层级未错位）

**Rollback point R2**：同 R1

---

## Step 3 — New Files 视口对齐

**文件**：`frontend/app/view/preview/preview-new-files.tsx`

**改动 E — 根节点上限**

```diff
- ... max-h-[500px] overflow-hidden flex flex-col"
+ ... max-h-[min(500px,calc(100vh-32px))] overflow-hidden flex flex-col"
```

**改动 F — middleware 补 flip/shift**

```diff
- import { useFloating, FloatingPortal, offset, useDismiss, useInteractions } from "@floating-ui/react";
+ import { useFloating, FloatingPortal, offset, useDismiss, useInteractions, flip, shift, limitShift } from "@floating-ui/react";
- middleware: [offset(8)],
+ middleware: [offset(8), flip(), shift({ padding: 12, limiter: limitShift() })],
```

**验证**

```bash
grep -n "max-h-\[min(500px\|flip()\|limitShift\|size(" frontend/app/view/preview/preview-new-files.tsx
```

- [ ] 根节点上限是视口相关
- [ ] middleware 里有 `flip()` + `shift()` + `limitShift()`
- [ ] **没有**引入 `size` middleware（会写内联 `overflowY:auto` 破坏内部滚动）
- [ ] 内部滚动容器 `flex-1 overflow-y-auto min-h-0` **未被改动**

**Rollback point R3**：`git checkout -- frontend/app/view/preview/preview-new-files.tsx`

---

## Step 4 — 静态检查与单测

```bash
npx tsc --noEmit
npx vitest run frontend/app/workspace frontend/app/view/preview frontend/app/block
```

- [ ] tsc 无新增错误
- [ ] vitest 全绿（记录用例数）

> 注：这两个命令耗时较长，**用 async 子代理执行**，不阻塞主会话。

**Rollback point R4**：同 R1 + R3

---

## Step 5 — CDP 实测（需 Electron 以 `--remote-debugging-port=9222` 运行）

```bash
node scripts/inspect-electron-ui.mjs state
node scripts/inspect-electron-ui.mjs elements --limit 40
node scripts/inspect-electron-ui.mjs style "Select a path"
node scripts/inspect-electron-ui.mjs screenshot
```

- [ ] 造 ≥ 15 个块的 tab → New Terminal：浮窗高度恒定 ≤ 640px
- [ ] 列表 `scrollHeight > clientHeight`（有滚动条），`overflow-y: auto`
- [ ] 根节点 `overflow-y: auto`（内联，**故意保留**作退化兜底）但**不出现滚动条**
      —— 溢出量被列表吸收；根节点 `maxHeight ≤ 640px`
- [ ] 滚动前后 footer 的 `getBoundingClientRect().top` 不变
- [ ] 列表滚到底继续滚 → 浮窗不跟着动
- [ ] ≤ 5 个块的 tab：外观与改动前一致，无滚动条
- [ ] New Files：高度 ≤ `min(500px, 100vh-32px)`，贴下缘时向上翻转

---

## Step 6 — 收尾

- [ ] `git diff --stat` 只包含 2 个预期文件
- [ ] `node .gitnexus/run.cjs analyze`（若索引过期则重跑）
- [ ] `detect_changes()` 确认影响面仅限预期符号与流程
- [ ] 更新 `.trellis/spec/`（若本次固化了「浮窗滚动契约」这类可复用约定）
- [ ] commit（preamble 见 trellis-check）
- [ ] `task.py archive`
