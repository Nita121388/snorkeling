# Design — Tabs 组「+」菜单的 Files 项支持二级路径中枢弹窗

> 父任务：`10-12-files-widget-path-hub`（提供路径中枢面板 / `path-panel-model` / `path-usage-store`）。
> 本任务**只做入口接线**，不改路径中枢内部实现。

## 1. Change Boundary（before-dev step 7）

**Smallest behavior gap**

- 现状：组「＋」菜单里 Terminal / Agent 点开会打开**二级目标选择浮窗**（`launch-popup-bus`），
  Files 却**直接建 preview block**（`buildFilesBlockDef` 继承活跃终端 cwd/connection），
  用户无法在组里挑「最近用过的路径」。
- 目标：Files 与 Terminal / Agent 对齐 —— 点开**同一个** `NewFilesFloatingWindow` 路径中枢，
  内容与右侧 WidgetsBar 的 Files **完全一致**，选中路径后 preview block **落回发起请求的那个组**。

**Where the behavior actually lives**

| 关注点 | 唯一落点 |
|---|---|
| 二级浮窗请求通道 | `frontend/app/workspace/launch-popup-bus.ts`（`LaunchPopupMode` / `LaunchPopupRequest`） |
| 二级浮窗的渲染与落点 | `frontend/app/workspace/widgets.tsx`（`subscribeLaunchPopup` 订阅、`groupSinkNodeId` sink 漏斗） |
| 一级菜单项 → 二级浮窗 | `frontend/app/block/inlinetab-addmenu.tsx`（`InlineTabGroupAddButton`） |
| 路径中枢面板本体 | `frontend/app/view/preview/preview-new-files.tsx`（**不改内容**，只放宽锚点类型） |

**Files expected to change**

| 文件 | 为什么必须改 |
|---|---|
| `frontend/app/workspace/launch-popup-bus.ts` | `LaunchPopupMode` 增 `"files"`；`LaunchPopupRequest` 增可选 `fallbackConnection` |
| `frontend/app/workspace/widgets.tsx` | 订阅端加 `files` 分支；`filesReferenceElement` 类型放宽；`onSelect` 走 sink 漏斗；新增统一关闭函数 |
| `frontend/app/view/preview/preview-new-files.tsx` | `referenceElement` prop 放宽到 `HTMLElement \| VirtualElement`（bus 传的是冻结快照虚拟锚点） |
| `frontend/app/block/inlinetab-addmenu.tsx` | Files 菜单项改为开二级浮窗；移除直接建块分支；`buildFilesBlockDef` 随之删除 |
| `frontend/app/block/inlinetab-addmenu.test.ts` | 删除 `buildFilesBlockDef` 的单测（函数已删） |

**Explicitly NOT doing (P0)**

- 不改路径中枢的数据模型 / 分区算法 / pin 配置键（属父任务 `10-12-files-widget-path-hub`）
- 不改右侧 WidgetsBar 的 Files 行为（悬浮开浮窗、点击建默认块 —— 完全不变）
- 不给路径中枢加「当前终端 cwd」入口（要改 `path-panel-model`，超出本任务边界）
- 不新增后端 RPC、不改 `settingsconfig.go`
- 不改 Quick Launch 弹窗、Ctrl+Hover 放置上下文、`pickGroupAddableWidgets` 过滤规则

**Local refactor safety**

- `buildFilesBlockDef` 及其单测删除后，仓库内无其它引用（已 grep 确认）。
- `NewFilesFloatingWindow` 的内容渲染逻辑**零改动**，只放宽 prop 类型 → 右侧栏路径零回退。

---

## 2. 关键技术点

### 2.1 bus 的锚点是「冻结快照」，不是真元素

`inlinetab-addmenu.tsx` 的 `makeFrozenAnchor()` 把菜单项的 `getBoundingClientRect()` 冻结成
`{ getBoundingClientRect, contextElement }` —— 这正是 floating-ui 的 **VirtualElement** 形状。

- `NewFilesFloatingWindow` 当前 prop 类型是 `HTMLElement | null` → **接不住** VirtualElement。
- floating-ui 的 `elements.reference` 原生接受 `Element | VirtualElement`
  （`@floating-ui/react` 导出了 `VirtualElement` 类型），所以只要放宽 prop 类型即可，无需额外适配。
- 冻结锚点的意义：二级浮窗锚定在 `overflow:auto` 的一级菜单里，鼠标移入浮窗的瞬间
  `autoUpdate`（layoutShift / elementResize）会重算导致**瞬移**；冻结后位置恒定。

### 2.2 sink 语义复用现成漏斗

`widgets.tsx` 已有组 sink 漏斗，Terminal / Agent 二级浮窗的落点都走它：

```ts
const createToCurrentTabForWindows = groupSinkNodeId == null ? createBlockInCurrentTab : createBlockInGroupSink;
```

- `createBlockInCurrentTab` = `env.createBlock(blockDef, magnified)` —— 与右侧栏 Files 现状**完全一致**。
- `createBlockInGroupSink` = 建块后 `addBlockToInlineTab(sinkNodeId, newBlockId)` 进组；
  组已关闭则回退为普通入 tab 插入（不丢用户选好的路径）。

因此 Files 的 `onSelect` 只需把 `env.createBlock(blockDef)` 换成
`createToCurrentTabForWindows(blockDef, false)`，**右侧栏无 sink 时行为逐字不变**。

### 2.3 一级 / 二级菜单协调

现有机制（Terminal / Agent 已在用）：

- `requestLaunchPopup({ onOpenChange })` → 订阅端在打开时 `launchPopupOnOpenChangeRef.current = req.onOpenChange`，
  关闭时回传 `false`。
- 一级菜单 `secondLevelOpen` 为真时**不收起**；二级关闭后由 `scheduleMenuClose()` 延时 220ms 收起。
- Esc 逐层关闭（一级监听 keydown 时若二级开着就跳过）。

Files 复用同一套，只需要在订阅端多一个分支 + 关闭时回传。

#### 2.3.1 必须一并修的既有缺陷：`notifyBus`

打开二级浮窗前，订阅端会先关掉另一个二级浮窗（`closeAgentTargetSelector` / `closeTerminalTargetSelector`）。
而这两个 close **在关闭时会回传 `onOpenChange(false)`**——于是「换浮窗」被误报成「二级被用户关掉」：

```
bus 打开 Files → closeAgentTargetSelector() → onOpenChange(false)
                              → 一级菜单 secondLevelOpenRef = false
                              → 一级菜单可能在 220ms 后收起
                              → Esc 一次关掉两层（因为它以为二级已经关了）
```

同一缺陷今天就存在于 Terminal / Agent 之间（`openAgentTargetsAt` → `closeTerminalTargetSelector()`）。
Files 接入后会继承它，直接违反 PRD R4，因此本任务一并修掉：

- `closeAgentTargetSelector` / `closeTerminalTargetSelector` / `closeFilesWindow` 增可选参数
  `notifyBus`（默认 `true` = 真正的关闭 → 回传 `false`）；
- 「换一个二级浮窗」的路径（`openAgentTargetsAt` / `openTerminalTargetsAt` / `openFilesWindowAt`）
  一律传 `false` → 不回传，二级开关状态由真正关闭的那个浮窗负责回传。

> 顺带：`openAgentTargetsAt` / `openTerminalTargetsAt` 现在会顺手关掉 Files 面板
> （`closeFilesWindow(false)`），避免两个二级浮窗同时开着（Files 面板只有 Esc / 点外面能关）。

### 2.4 connection 兜底

`PathSelection = { path: string; connection?: string }`。

- 面板里来自使用记录的路径**自带** connection（远端路径用它自己的）。
- `Home`（`~`）行没有 connection。

组场景下若组内存在活跃终端 block，用它的 `connection` 作为**兜底**：
用户显式选中某路径时以该行自带的 connection 为准。

实现：bus 请求增可选字段 `fallbackConnection?: string | null`，
由 `inlinetab-addmenu` 用 `extractTerminalContextMeta(activeBlock)?.connection` 填充。

---

## 3. 具体改动

### 3.1 `frontend/app/workspace/launch-popup-bus.ts`

```diff
-export type LaunchPopupMode = "terminal" | "agent";
+export type LaunchPopupMode = "terminal" | "agent" | "files";
```

```diff
 export type LaunchPopupRequest = {
     mode: LaunchPopupMode;
     ...
+    /**
+     * Fallback connection for the "files" mode: the group sink's active terminal connection.
+     * Used only when the picked path row carries no connection of its own (e.g. Home "~").
+     */
+    fallbackConnection?: string | null;
 };
```

### 3.2 `frontend/app/view/preview/preview-new-files.tsx`

```diff
-import { useFloating, FloatingPortal, offset, useDismiss, useInteractions, flip, shift, limitShift } from "@floating-ui/react";
+import { useFloating, FloatingPortal, offset, useDismiss, useInteractions, flip, shift, limitShift, type VirtualElement } from "@floating-ui/react";
```

```diff
 type NewFilesFloatingWindowProps = {
     ...
-    referenceElement: HTMLElement | null;
+    /** HTMLElement（右侧栏 widget 按钮）或 floating-ui VirtualElement（组「＋」菜单的冻结锚点快照）。 */
+    referenceElement: HTMLElement | VirtualElement | null;
 };
```

> `elements: { reference: referenceElement }` 无需改动 —— floating-ui 的 `reference` 本就接受
> `Element | VirtualElement`。面板内容渲染逻辑**零改动**。

### 3.3 `frontend/app/workspace/widgets.tsx`

**(a) 状态类型放宽**

```diff
-const [filesReferenceElement, setFilesReferenceElement] = useState<HTMLElement | null>(null);
+const [filesReferenceElement, setFilesReferenceElement] = useState<LaunchPopupAnchor | null>(null);
```

**(b) 新增统一打开 / 关闭函数**

```ts
const openFilesWindowAt = useCallback(
    (referenceElement: LaunchPopupAnchor, sinkNodeId: string | null, fallbackConnection: string | null) => {
        closeAgentTargetSelector();
        closeTerminalTargetSelector();   // 这两个会把 groupSinkNodeId 置 null → 必须先关再设
        setFilesReferenceElement(referenceElement);
        setGroupSinkNodeId(sinkNodeId);
        setFilesFallbackConnection(fallbackConnection);
        setIsFilesWindowOpen(true);
    },
    [closeAgentTargetSelector, closeTerminalTargetSelector]
);

const closeFilesWindow = useCallback(() => {
    setIsFilesWindowOpen(false);
    setFilesReferenceElement(null);
    setFilesFallbackConnection(null);
    // 回传 bus 发起方：二级已关闭（用于其一级菜单收起协调）。
    if (launchPopupBusOpenedRef.current) {
        launchPopupOnOpenChangeRef.current?.(false);
        launchPopupBusOpenedRef.current = false;
        launchPopupOnOpenChangeRef.current = null;
    }
    setGroupSinkNodeId(null);
}, []);
```

**(c) 订阅端加 `files` 分支**

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

**(d) `NewFilesFloatingWindow` 的 `onSelect` 走 sink 漏斗**

```diff
 onSelect={(selection: PathSelection) => {
     fireAndForget(async () => {
         const blockDef: BlockDef = {
             meta: {
                 view: "preview",
                 file: selection.path,
-                connection: selection.connection ?? "local",
+                connection: selection.connection ?? filesFallbackConnection ?? "local",
             },
         };
-        await env.createBlock(blockDef);
+        await createToCurrentTabForWindows(blockDef, false);
+        closeFilesWindow();
     });
 }}
```

> `createToCurrentTabForWindows` 在 `groupSinkNodeId == null` 时就是 `env.createBlock(blockDef, false)`，
> 与右侧栏现状一致（`env.createBlock(blockDef)` 的 `magnified` 默认 false）。

**(e) 右侧栏 Files 关闭路径统一走 `closeFilesWindow`**

`handleWidgetSelect` 里那句 `setIsFilesWindowOpen(false)` 改为 `closeFilesWindow()`，
保证状态与 bus 回传标志一致（右侧栏路径 `launchPopupBusOpenedRef` 为 false，不会误回传）。

**(f) 渲染处传参**

```diff
 {filesReferenceElement != null && (
     <NewFilesFloatingWindow
         isOpen={isFilesWindowOpen}
-        onClose={() => setIsFilesWindowOpen(false)}
+        onClose={closeFilesWindow}
         referenceElement={filesReferenceElement}
```

### 3.4 `frontend/app/block/inlinetab-addmenu.tsx`

**(a) mode 扩项**

```diff
-const mode: "terminal" | "agent" | null =
-    id === DefaultTerminalWidgetId ? "terminal" : id === DefaultAgentWidgetId ? "agent" : null;
+const mode: "terminal" | "agent" | "files" | null =
+    id === DefaultTerminalWidgetId
+        ? "terminal"
+        : id === DefaultAgentWidgetId
+          ? "agent"
+          : id === DefaultFilesWidgetId
+            ? "files"
+            : null;
```

**(b) `isTargetWidget` 判定加 Files**（用于显示 chevron 提示）

```diff
-const isTargetWidget = id === DefaultTerminalWidgetId || id === DefaultAgentWidgetId;
+const isTargetWidget = id === DefaultTerminalWidgetId || id === DefaultAgentWidgetId || id === DefaultFilesWidgetId;
```

**(c) 移除 Files 的直接建块分支**

```diff
-if (widgetId === "defwidget@files") {
-    blockDef = buildFilesBlockDef(blockDef, activeBlock);
-}
```

**(d) 删除 `buildFilesBlockDef` 及其单测**（仓库内无其它引用）

**(e) `fallbackConnection` 传入**

`startItemHover` / `requestTargetPopup` 的 `requestLaunchPopup` 调用增
`fallbackConnection: extractTerminalContextMeta(activeBlock)?.connection ?? null`。

---

## 4. 交互时序

```
用户 hover「＋」 → 120ms 后开一级菜单
  └─ hover Files 项 → 500ms（LaunchHoverOpenDelayMs）→ 开二级路径中枢浮窗（锚定该菜单项的冻结快照）
     └─ 点击 Files 项 → 立即开二级（一级菜单保持开启）
        ├─ 选中路径 → 建 preview block → 进发起组并激活 → 关二级 → 一级延时 220ms 收起
        ├─ Esc → 关二级 → 回传 onOpenChange(false) → 一级收起
        └─ 指针移出 → 二级关 → 一级收起
```

与 Terminal / Agent 的时序**完全一致**。

---

## 5. 边界情况

| 场景 | 行为 |
|---|---|
| 组内无活跃终端 | `extractTerminalContextMeta` 返回 null → `fallbackConnection` 为 null → 选中无 connection 的路径时回退 `"local"` |
| 用户显式选远端路径 | 该行自带 connection → 以行为准，不用兜底 |
| 选中 `Home`（`~`） | 无自带 connection → 组场景用活跃终端 connection；右侧栏场景仍是 `"local"` |
| 组在浮窗打开期间被关 | `createBlockInGroupSink` 的 `addBlockToInlineTab` 失败 → 回退普通入 tab 插入，路径不丢 |
| 一级菜单先关 | 二级浮窗独立存在（`FloatingPortal`），选完仍能落组 |
| 右侧 WidgetsBar Files | **零改动**：悬浮开浮窗、点击建默认块、Pin/Unpin/Copy/Remove/Home 全部照旧（仅在打开 Agent/Terminal 二级浮窗时顺手收起 Files 面板，避免两个浮窗并存） |
| 面板内容 | `NewFilesFloatingWindow` 渲染逻辑零改动 → 分区 / 搜索 / 键盘 / 行内按钮与右侧栏逐项一致 |

---

## 6. 兼容与回滚

- **向后兼容**：bus 的 `LaunchPopupMode` 是**联合类型新增成员**，不破坏既有 `"terminal" | "agent"` 调用方。
- **数据兼容**：不涉及持久化格式变化；pin / usage 配置键不变。
- **回滚形状**：`launch-popup-bus.ts` + `inlinetab-addmenu.tsx` + `widgets.tsx` 三处一起回滚即可；
  `preview-new-files.tsx` 的类型放宽可独立保留（向后兼容）。
- **不做 feature flag**：右侧栏行为完全不变，风险面仅限新增入口。

---

## 7. 验证方式

1. **Vitest**：`frontend/app/block/inlinetab-addmenu.test.ts`（删除 `buildFilesBlockDef` 用例后仍全绿）、
   `frontend/app/workspace` 现有用例全绿。
2. **手测（CDP 或真机）**：
   - 组内多 tab → 「＋」→ hover Files ≈500ms → 二级浮窗出现在菜单项右侧，
     分区与右侧 WidgetsBar 打开的**完全一致**；
   - 点击 Files → 立即开二级；一级菜单保持开启；
   - 选一个最近路径 → preview block 进入**当前组**并激活；
   - Pin / Unpin / Copy / Remove / Home 与右侧栏表现一致（同一份状态，双向同步）；
   - 指针从二级移出 → 二级关、一级 220ms 后关；Esc 逐层关闭；
   - 右侧 WidgetsBar Files 悬浮 → 浮窗正常，选路径 → 普通建块（不进任何组）。
3. **TypeScript**：`npx tsc --noEmit` 无新增错误。
