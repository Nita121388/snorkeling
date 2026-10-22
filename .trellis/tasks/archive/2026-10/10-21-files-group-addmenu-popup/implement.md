# Implement — Tabs 组「+」菜单的 Files 项支持二级路径中枢弹窗

> 执行顺序：bus 契约 → 面板锚点类型 → 订阅端接线 → 一级菜单接线 → 清理 → 验证。
> 每步都可单独验证；Step 1~3 是「面板能接住新锚点」，Step 4 是「菜单能发出新请求」。

## Step 0 — 前置检查（不改代码）

```bash
git status --short
git log --oneline -1
```

- [ ] 确认起点干净（`.trellis/` 未跟踪不算脏）
- [ ] 确认上一个任务（`10-22-path-select-popup-scroll`）已 commit

**Rollback point R0**：无改动，随时可放弃。

---

## Step 1 — bus 契约扩展

**文件**：`frontend/app/workspace/launch-popup-bus.ts`

**改动**

```diff
-export type LaunchPopupMode = "terminal" | "agent";
+export type LaunchPopupMode = "terminal" | "agent" | "files";
```

`LaunchPopupRequest` 增可选字段：

```ts
/**
 * Fallback connection for the "files" mode: the group sink's active terminal connection.
 * Used only when the picked path row carries no connection of its own (e.g. Home "~").
 */
fallbackConnection?: string | null;
```

**验证**

```bash
grep -n "LaunchPopupMode\|fallbackConnection" frontend/app/workspace/launch-popup-bus.ts
```

- [ ] `LaunchPopupMode` 含 `"files"`
- [ ] `fallbackConnection` 是**可选**字段（既有 `"terminal" | "agent"` 调用方不受影响）

**Rollback point R1**：`git checkout -- frontend/app/workspace/launch-popup-bus.ts`

---

## Step 2 — 面板锚点类型放宽

**文件**：`frontend/app/view/preview/preview-new-files.tsx`

**改动**

```diff
-import { useFloating, FloatingPortal, offset, useDismiss, useInteractions, flip, shift, limitShift } from "@floating-ui/react";
+import { useFloating, FloatingPortal, offset, useDismiss, useInteractions, flip, shift, limitShift, type VirtualElement } from "@floating-ui/react";
```

```diff
-    referenceElement: HTMLElement | null;
+    /** HTMLElement（右侧栏 widget 按钮）或 floating-ui VirtualElement（组「＋」菜单的冻结锚点快照）。 */
+    referenceElement: HTMLElement | VirtualElement | null;
```

**验证**

```bash
grep -n "VirtualElement\|referenceElement" frontend/app/view/preview/preview-new-files.tsx
```

- [ ] prop 类型已放宽
- [ ] 面板**内容渲染逻辑零改动**（只有 import 与 type 两处）
- [ ] `useFloating` 的 `elements: { reference: referenceElement }` 未改
      （floating-ui 的 reference 本就接受 `Element | VirtualElement`）

**Rollback point R2**：`git checkout -- frontend/app/view/preview/preview-new-files.tsx`

---

## Step 3 — 订阅端接线（widgets.tsx）

**文件**：`frontend/app/workspace/widgets.tsx`

**改动 A — 状态类型放宽**

```diff
-const [filesReferenceElement, setFilesReferenceElement] = useState<HTMLElement | null>(null);
+const [filesReferenceElement, setFilesReferenceElement] = useState<LaunchPopupAnchor | null>(null);
```

并新增 `filesFallbackConnection` state（`string | null`）。

**改动 B — 新增 `openFilesWindowAt` / `closeFilesWindow`**

- `openFilesWindowAt(referenceElement, sinkNodeId, fallbackConnection)`：
  先 `closeAgentTargetSelector()` + `closeTerminalTargetSelector()`
  （**它们会把 `groupSinkNodeId` 置 null，必须先关再设**），再设
  `filesReferenceElement` / `groupSinkNodeId` / `filesFallbackConnection` / `isFilesWindowOpen=true`。
- `closeFilesWindow()`：清 `isFilesWindowOpen` / `filesReferenceElement` / `filesFallbackConnection`；
  若 `launchPopupBusOpenedRef.current` 为真 → 回传 `launchPopupOnOpenChangeRef.current?.(false)` 并清标志；
  最后 `setGroupSinkNodeId(null)`。

**改动 C — 订阅端分支**

```diff
 if (req.mode === "agent") {
     openAgentTargetsAt(req.anchorEl, false, req.nodeId);
+} else if (req.mode === "terminal") {
+    openTerminalTargetsAt(req.anchorEl, false, undefined, req.nodeId);
 } else {
-    openTerminalTargetsAt(req.anchorEl, false, undefined, req.nodeId);
+    openFilesWindowAt(req.anchorEl, req.nodeId ?? null, req.fallbackConnection ?? null);
 }
```

**改动 D — `onSelect` 走 sink 漏斗**

```diff
-                connection: selection.connection ?? "local",
+                connection: selection.connection ?? filesFallbackConnection ?? "local",
...
-            await env.createBlock(blockDef);
+            await createToCurrentTabForWindows(blockDef, false);
+            closeFilesWindow();
```

**改动 E — 右侧栏关闭路径统一**

`handleWidgetSelect` 里的 `setIsFilesWindowOpen(false)` → `closeFilesWindow()`。
渲染处 `onClose={() => setIsFilesWindowOpen(false)}` → `onClose={closeFilesWindow}`。

**改动 F — `notifyBus`：修正「换浮窗」被误报成「二级已关」的既有缺陷**

三个二级浮窗的 close 函数在关闭时会回传 `onOpenChange(false)` 给 bus 发起方（一级菜单），
而「打开另一个二级浮窗」也要先 close 当前浮窗 → 一级菜单会误以为二级已关
（提前 220ms 收起 + Esc 一次关两层）。今天就存在于 Terminal / Agent 之间，Files 接入后继承。

- `closeAgentTargetSelector` / `closeTerminalTargetSelector` / `closeFilesWindow`
  增可选参数 `notifyBus`（默认 `true` = 真正的关闭 → 回传 `false`）
- 「换浮窗」的路径传 `false`：
  - `openAgentTargetsAt` → `closeTerminalTargetSelector(false)` + `closeFilesWindow(false)`
  - `openTerminalTargetsAt` → `closeAgentTargetSelector(false)` + `closeFilesWindow(false)`
  - `openFilesWindowAt` → `closeAgentTargetSelector(false)` + `closeTerminalTargetSelector(false)`
- 副作用：打开 Agent/Terminal 二级浮窗时会顺手关掉 Files 面板（避免两个二级浮窗并存）
- 依赖数组同步补 `closeFilesWindow`

**验证**

```bash
grep -n "openFilesWindowAt\|closeFilesWindow\|filesFallbackConnection\|createToCurrentTabForWindows" frontend/app/workspace/widgets.tsx
```

- [ ] `openFilesWindowAt` 先关两个 target selector，再设 `groupSinkNodeId`（顺序正确）
- [ ] `closeFilesWindow` 回传 `onOpenChange(false)` 并清 `launchPopupBusOpenedRef`
- [ ] 三个 close 都有 `notifyBus` 参数；「换浮窗」路径传 `false`（不回传 false）
- [ ] `onSelect` 用 `createToCurrentTabForWindows`，未直接调 `env.createBlock`
- [ ] 右侧栏路径（`groupSinkNodeId == null`）行为与改动前**逐字一致**

**Rollback point R3**：`git checkout -- frontend/app/workspace/widgets.tsx`

---

## Step 4 — 一级菜单接线（inlinetab-addmenu.tsx）

**文件**：`frontend/app/block/inlinetab-addmenu.tsx`

**改动 A — mode 扩项 + `isTargetWidget` 加 Files**

```diff
-const isTargetWidget = id === DefaultTerminalWidgetId || id === DefaultAgentWidgetId;
-const mode: "terminal" | "agent" | null =
-    id === DefaultTerminalWidgetId ? "terminal" : id === DefaultAgentWidgetId ? "agent" : null;
+const isTargetWidget = id === DefaultTerminalWidgetId || id === DefaultAgentWidgetId || id === DefaultFilesWidgetId;
+const mode: "terminal" | "agent" | "files" | null =
+    id === DefaultTerminalWidgetId
+        ? "terminal"
+        : id === DefaultAgentWidgetId
+          ? "agent"
+          : id === DefaultFilesWidgetId
+            ? "files"
+            : null;
```

**改动 B — 移除 Files 的直接建块分支**

```diff
-if (widgetId === "defwidget@files") {
-    blockDef = buildFilesBlockDef(blockDef, activeBlock);
-}
```

**改动 C — 删除 `buildFilesBlockDef` 函数**（仓库内无其它引用）

**改动 D — `fallbackConnection` 传入**

`startItemHover` 与 `requestTargetPopup` 里的 `requestLaunchPopup({...})` 增：

```ts
fallbackConnection: extractTerminalContextMeta(activeBlock)?.connection ?? null,
```

**验证**

```bash
grep -rn "buildFilesBlockDef" frontend/ --include=*.ts --include=*.tsx
grep -n "DefaultFilesWidgetId\|\"files\"" frontend/app/block/inlinetab-addmenu.tsx
```

- [ ] `buildFilesBlockDef` 在仓库内**零引用**（函数与测试都删干净）
- [ ] `DefaultFilesWidgetId` 已 import
- [ ] `mode` 三态齐全，`requestLaunchPopup` 的 mode 类型接受 `"files"`
- [ ] Files 菜单项有 chevron 提示（`isTargetWidget` 含 Files）

**Rollback point R4**：`git checkout -- frontend/app/block/inlinetab-addmenu.tsx frontend/app/block/inlinetab-addmenu.test.ts`

---

## Step 5 — 清理测试

**文件**：`frontend/app/block/inlinetab-addmenu.test.ts`

- [ ] 删除 `describe("buildFilesBlockDef")` 整个块
- [ ] `pickGroupAddableWidgets` 的既有用例保留且仍绿

---

## Step 6 — 静态检查与单测

```bash
npx tsc --noEmit
npx vitest run frontend/app/block frontend/app/workspace frontend/app/view/preview
```

- [ ] tsc 无新增错误（重点看 `LaunchPopupMode` 联合类型扩展后所有 switch/分支是否穷尽）
- [ ] vitest 全绿（记录用例数）

> 注：这两个命令耗时较长，**用 async 子代理执行**，不阻塞主会话。

**Rollback point R5**：R1~R4 一起回滚

---

## Step 7 — 手测（CDP 或真机）

- [ ] 组内多 tab（blockIds.length > 1）→「＋」→ hover Files ≈500ms → 二级浮窗出现在菜单项右侧
- [ ] 二级浮窗分区与右侧 WidgetsBar 打开的**完全一致**
- [ ] 点击 Files → 立即开二级；一级菜单保持开启
- [ ] 选一个最近路径 → preview block 进入**当前组**并激活
- [ ] 二级里 Pin / Unpin / Copy / Remove / Home 与右侧栏表现一致（同一份状态，双向同步）
- [ ] 鼠标从二级移出到空白处 → 二级关、一级 220ms 后关；Esc 逐层关闭
- [ ] 右侧 WidgetsBar Files 悬浮 → 浮窗正常，选路径 → 普通建块（**不进任何组**）

---

## Step 8 — 收尾

- [ ] `git diff --stat` 只包含 5 个预期文件
- [ ] `node .gitnexus/run.cjs analyze`（若索引过期则重跑）
- [ ] `detect_changes()` 确认影响面仅限预期符号与流程
- [ ] 更新 `.trellis/spec/`（若本次固化了「二级浮窗 bus 扩展」这类可复用约定）
- [ ] commit（preamble 见 trellis-check）
- [ ] `task.py archive`
