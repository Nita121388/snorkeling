# Design: 列表多选与批量操作 — AI Sessions + Files

## 0. 一句话结构

修饰键多选（Ctrl toggle / Shift range / Ctrl+A / Esc） + 空白拖拽框选（DOM 矩形求交）+ 批量复制栏。
框选几何函数抽成共享纯模块，两个视图复用；其余各自接入。

---

## M1 — 共享框选几何（`frontend/app/util/selectionrect.ts`）

纯函数、无 DOM 依赖之外的轻量类型，可直接单测：

```ts
export type Rect = { left: number; top: number; right: number; bottom: number };

/** 两矩形相交（含边贴边不算相交，避免抖动）。 */
export function rectsIntersect(a: Rect, b: Rect): boolean;

/** 从行 DOM 列表里筛出与 rect 相交的 data-session-key / 行标识。 */
export function keysUnderRect(
    rect: Rect,
    rows: { key: string; el: HTMLElement }[]
): string[];

/** 位移超过该阈值即视为拖拽（框选），否则按点击处理。 */
export const DragThresholdPx = 4;
export function dragDistance(dx: number, dy: number): boolean;  // >= DragThresholdPx
```

`keysUnderRect` 接收「已取好的 `{key, el}`」而非自己 querySelector：调用方才知道该用哪个属性名（AI Sessions 是 `data-session-key`，Files 是 `data-rowindex` + 行路径）。

---

## M2 — AI Sessions 选区与手势

### 2.1 State（`aisessions.tsx`）

```ts
selectedKeysAtom = jotai.atom<string[]>([])      // 多选集合（有序，决定复制产物顺序）
selectionAnchorAtom = jotai.atom<string>("")     // Shift 范围锚点
marqueeRectAtom  = jotai.atom<Rect | null>(null) // 框选矩形（null = 未在框选）
```

`selectedKeyAtom` 保持「当前行」（详情面板绑定它）。多选集合独立。

**裁剪不变量**：`visibleSessions` 变化时执行

```ts
useEffect(() => {
    const visibleKeys = new Set(visibleSessions.map((s) => s.key));
    const current = globalStore.get(model.selectedKeysAtom);
    const pruned = current.filter((k) => visibleKeys.has(k));
    if (pruned.length !== current.length) globalStore.set(model.selectedKeysAtom, pruned);
}, [visibleSessions]);
```

`pruneSelectionToVisible` 作为纯函数放 `utils.ts` 并单测。

### 2.2 手势接入

行点击（`aisessions.tsx:1910` 的 `onSelectSession`）改为三分支：

```ts
onSelectSession={(session, event) => {
    // Ctrl/Cmd+双击 = 强制新开 Block（由 onOpenSession 的 event 判定，见 2.3）
    if (event.metaKey || event.ctrlKey) {
        toggleInSelection(session.key);        // 多选切换，同时设 selectedKey
        return;
    }
    if (event.shiftKey) {
        applyRangeFromAnchor(session.key);     // 范围选
        return;
    }
    setSelection([session.key]);               // 单选：清空多选
    ...原有「详情块 / 纯列表块」分支...
}}
```

`applyRangeFromAnchor(anchor, target)` 用 `visibleSessions` 的 key 顺序切片，锚点为空时退化为单选。

**Ctrl+A / Esc**：挂在列表面板已有的键盘入口（`aisessions.tsx:1754` 的搜索框 `onKeyDown` 同级，需要给列表面板根 div 加 `onKeyDown` + `tabIndex`），或复用 block 级 `directoryKeyDownHandler` 模式。**实现时先确认哪种不会与搜索框抢键**：搜索框聚焦时 Ctrl+A 应全选文本而非列表——用「事件目标不在 input 内」判定。

### 2.3 Ctrl+双击迁移

`session-row.tsx` 的 `onDoubleClick` 已带 event，直接透传：

```tsx
onDoubleClick={(event) => { if (isRowActionTarget(event)) return; onOpen?.(event); }}
```

上层：

```tsx
onOpenSession={(session, event) => openSessionDetail(session, event.metaKey || event.ctrlKey)}
```

原 `onSelectSession` 里的 `if (event.metaKey || event.ctrlKey) { openSessionDetail(session, true); return; }` **删除**。

### 2.4 框选

滚动容器（`aisessions.tsx:1873` `<div className="min-h-0 flex-1 overflow-auto">`）加 `onMouseDown`：

```tsx
onMouseDown={(event) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-row-action], [data-session-key]")) {
        // 点在行/按钮上：不启动框选（行自己的 onClick 处理多选）
        // 例外：点在行上但最终成了拖拽 → mouseup 时按点击处理，见 2.5
        return;
    }
    startMarquee(event);
}}
```

`startMarquee` 记录起点（viewport 坐标 + scrollTop），`mousemove` 超 4px 后置 `marqueeRectAtom`，每帧：

```ts
const rows = [...container.querySelectorAll("[data-session-key]")].map((el) => ({
    key: (el as HTMLElement).dataset.sessionKey!,
    el: el as HTMLElement,
}));
const hit = keysUnderRect(rect, rows);
setSelection(event.ctrlKey || event.metaKey ? union(current, hit) : hit);
```

`mousemove` 用 `requestAnimationFrame` 节流；`mouseup` 清矩形。监听挂 `document`（拖拽会移出容器），组件卸载时移除。

**滚动跟随**：框选期间容器滚动，rect 要按 `scrollTop` 增量同步偏移，否则选中的行会漂。实现：rect 存「文档坐标」（clientY + scrollTop），每帧重算可见部分。

### 2.5 点击 vs 框选的仲裁

行上的 `mousedown` 也记录起点，`mouseup` 时若位移 < 4px 才放行 `onSelect`。做法：在容器 `onMouseDown` 记 `pendingClick`，在 `document` 的 `mouseup` 里判定位移，超阈值则设 `suppressClickRef.current = true`，行的 `onClick` 检查该 ref 并重置。

`session-row.tsx:334` 的 `onClick` 已有 `isRowActionTarget` 前置，照旧加这一层。

### 2.6 视觉

- 单选行：现状 `bg-accent/10 before:...before:bg-accent`
- 选区内行（非单选）：左侧 2px accent/60 竖条 + `bg-accent/5`
- 框选矩形：`absolute` overlay，`border border-accent/60 bg-accent/10`，`pointer-events-none`

### 2.7 批量操作栏（新组件 `session-batch-bar.tsx`）

放在 `{visibleSessions.length} sessions` 那一行**上方**，`selectedKeys.length > 0` 时渲染：

```tsx
export function SessionBatchBar({
    selectedCount, onCopy, onStar, onUnstar, onClear, copiedLabel,
}: {...}) 
```

按钮走 `controls.tsx` 的 `IconButton` 尺寸（h-7）。复制反馈：点击后按钮区显示 `Copied ✓` 700ms（复用 `session-menu.tsx` 的 `copyAndClose` 模式）。

**窄窗口**：`flex flex-wrap gap-2`，按钮优先保留 Copy IDs / Clear。

### 2.8 复制纯函数（`utils.ts`）

```ts
export type BatchCopyKind = "ids" | "filePaths" | "projectPaths" | "resumeCommands";
export function buildBatchCopyText(sessions: SessionSummary[], kind: BatchCopyKind): string
```

- `ids`：`session.id` 每行一个（跳过空）
- `filePaths`：`session.filePath`（跳过空）
- `projectPaths`：`session.projectPath` **去重保序**（跳过空）
- `resumeCommands`：`restoreCommandForSession(session)` 复用现有函数
- 空输入 / 全空字段 → `""`（`copyText` 已有空串保护）
- 分隔符 `\n`；Windows 路径不做引号转义（剪贴板原文）

---

## M3 — 评审点

- 选区裁剪是否在所有 `visibleSessions` 变更路径生效（筛选、刷新、新会话占位）
- `selectedKeyAtom` 与 `selectedKeysAtom` 的职责边界是否被说清（前者=详情绑定，后者=批量操作）
- 框选的 scrollTop 补偿是否测试过（长列表滚动中框选）

---

## M4 — Files 接入（`preview-directory.tsx`）

**只做三件事**，其余全不动：

1. **框选**：`dir-table-body` 容器加同样的 `onMouseDown` + marquee 逻辑；行标识用 `data-rowindex` → `row.getValue("path")`。复用 `keysUnderRect`。
2. **选中计数**：`selectedPaths.size > 0` 时在目录头或状态行显示 `N selected`（放现有 warning box 附近，具体位置实现时定）。
3. **Ctrl+A**：`model.directoryKeyDownHandler`（`preview-directory.tsx:759`）加 `checkKeyPressed(waveEvent, "Cmd:a") || checkKeyPressed(waveEvent, "Ctrl:a")` → `setSelectedPaths(new Set(allRows.map(r => r.getValue("path"))))`。需排除 `..` 行（与既有 `dotdotRow` 处理一致）。

**明确不动**：`copyPreviewFileItems` / `cutPreviewFileItems` / `handleFileDeletes` / 右键菜单 / `PreviewFileClipboard` / Esc（已实现）/ 双击 forceNewBlock（已实现）。

---

## 兼容与回滚

- 无后端改动；无持久化（选区与筛选一样是 widget 局部态）
- 唯一行为变化：Ctrl+单击从「开新块」变成「多选」，Ctrl+双击开新块。这是用户确认的迁移
- 各 Phase 独立可 revert

## 风险

1. **框选与行点击抢事件** —— 4px 阈值 + `suppressClickRef`，需单测 + 手动验证「点行不触发框选、拖行才触发」
2. **Ctrl+A 与搜索框/输入框冲突** —— 用事件目标是否在 input 内判定
3. **选区裁剪时机** —— `visibleSessions` 每次刷新都变，用 `useEffect` 依赖数组而非手动调用
4. **长列表框选性能** —— 每帧 `querySelectorAll` + N 次 `getBoundingClientRect`；会话量 3000 时约 200 行 DOM（limit 200），可接受；若卡顿改为缓存行 rect + scrollTop 偏移
5. **Files 侧 `data-rowindex` 是索引不是 key** —— 必须先映射成 path 再进选区，注意 `dotdotRow` 排除
6. **Star 批量写入是 N 次 RPC** —— 复用 `model.toggleMark`；若实测慢，后续单独加批量 RPC（本任务不做）
