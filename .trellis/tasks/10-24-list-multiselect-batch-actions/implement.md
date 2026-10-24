# Implement: 列表多选与批量操作

> 各 Milestone 结束是回滚点。M2/M3/M4 开始前先过前一阶段评审。
> **不碰**：`pkg/**`（零后端改动）、Files 的剪贴板与删除逻辑、AI Sessions 的筛选代码。
> 工作区有 60+ 无关未提交改动，只碰本任务文件。

## M1 — 共享框选几何

新建 `frontend/app/util/selectionrect.ts`：

- [ ] `type Rect = { left; top; right; bottom }`
- [ ] `rectsIntersect(a, b)`：标准相交，**边贴边不算**（`a.right <= b.left` 等四种情况返回 false）
- [ ] `keysUnderRect(rect, rows: {key, el}[])`：用 `el.getBoundingClientRect()` 转 Rect 后求交，返回按传入顺序的 key 数组
- [ ] `DragThresholdPx = 4`
- [ ] `isDragMovement(dx, dy)`：`Math.max(Math.abs(dx), Math.abs(dy)) >= DragThresholdPx`

新建 `frontend/app/util/selectionrect.test.ts`：

- [ ] 相交：包含、部分重叠、交叉
- [ ] 不相交：完全分离、边贴边（四条边各一例）
- [ ] `keysUnderRect`：全中、全不中、部分中、顺序保持
- [ ] `isDragMovement`：0/3/4/5 px 边界

```bash
npx vitest run frontend/app/util/selectionrect
npx eslint frontend/app/util/selectionrect.ts
```

## M2 — AI Sessions 选区与手势

`frontend/app/view/aisessions/aisessions.tsx`

- [ ] 新 atom：`selectedKeysAtom`（`string[]`）、`selectionAnchorAtom`（`string`）、`marqueeRectAtom`（`Rect | null`）
- [ ] model 方法：
      - `toggleInSelection(key)`：多选切换 + 设 `selectedKeyAtom` + 更新 anchor
      - `setSelection(keys)`：替换选区，同步 anchor 为最后一个
      - `selectRangeFromAnchor(targetKey)`：按 `visibleSessions` key 顺序切片
      - `selectAllVisible()` / `clearSelection()`
      - `startMarquee(event)` / 内部 `updateMarquee` / `stopMarquee`
- [ ] `onSelectSession`（~1910）三分支：ctrl → toggle；shift → range；否则单选 + 原详情逻辑
- [ ] **删除** `onSelectSession` 里的 `if (event.metaKey || event.ctrlKey) { openSessionDetail(session, true); return; }`
- [ ] `onOpenSession` 改为 `(session, event) => openSessionDetail(session, event.metaKey || event.ctrlKey)`
- [ ] 滚动容器 `onMouseDown` 启动框选（排除 `[data-row-action]` / `[data-session-key]` 目标）
- [ ] 框选 overlay 渲染（`absolute inset-0 pointer-events-none border border-accent/60 bg-accent/10`）
- [ ] 选区裁剪 `useEffect`（依赖 `visibleSessions`）
- [ ] Ctrl+A / Esc 键盘入口（列表面板根 div `onKeyDown`，判定目标不在 input 内）
- [ ] 行视觉：`session-group.tsx` 传 `inSelection`，`session-row.tsx` 加对应样式
- [ ] `suppressClickRef`：框选位移超阈值时抑制行的 `onClick`

`frontend/app/view/aisessions/utils.ts`

- [ ] `pruneSelectionToVisible(selection, visibleKeys)`：保序裁剪，纯函数
- [ ] `applySelectionRange(visibleKeys, anchor, target)`：锚点空/不存在 → `[target]`

`frontend/app/view/aisessions/utils.test.ts`

- [ ] `pruneSelectionToVisible`：空选区、全保留、部分裁剪、顺序保持、重复 key 去重
- [ ] `applySelectionRange`：正/反向、锚点在目标后、锚点不存在、锚点空、目标不在可见集

**评审点**：选区裁剪覆盖所有 `visibleSessions` 变更路径；`selectedKeyAtom` vs `selectedKeysAtom` 职责说清。

## M3 — 批量操作栏

`frontend/app/view/aisessions/utils.ts`

- [ ] `type BatchCopyKind = "ids" | "filePaths" | "projectPaths" | "resumeCommands"`
- [ ] `buildBatchCopyText(sessions, kind)`：跳过空字段；`projectPaths` 去重保序；`resumeCommands` 复用 `restoreCommandForSession`；空 → `""`

新建 `frontend/app/view/aisessions/session-batch-bar.tsx`

- [ ] props：`selectedCount` / `onCopy(kind)` / `onStar` / `onUnstar` / `onClear` / `copiedLabel`
- [ ] `selectedCount === 0` 返回 null
- [ ] 按钮：Copy IDs / Copy file paths / Copy working dirs / Copy resume commands / Star / Unstar / Clear
- [ ] 复制成功反馈 700ms（照 `session-menu.tsx` 的 `copyAndClose`）
- [ ] `flex flex-wrap gap-2` 窄窗口换行

`aisessions.tsx`

- [ ] 渲染 `<SessionBatchBar>`（放在 `{visibleSessions.length} sessions` 行上方）
- [ ] `onCopy(kind)` → `copyText(buildBatchCopyText(selectedSessions, kind))`
- [ ] `selectedSessions` = `visibleSessions.filter(s => selectedKeys.includes(s.key))`（**按选区顺序**，不是列表顺序）
- [ ] `onStar` / `onUnstar` → 对选中项逐个 `model.toggleMark`

`utils.test.ts`

- [ ] `buildBatchCopyText` 四种 kind；空 session 数组；字段缺失跳过；`projectPaths` 去重；Windows 路径原样不转义

**评审点**：复制产物顺序 = 用户点击顺序；Star 是 N 次 RPC（已知，接受）。

## M4 — Files 接入

`frontend/app/view/preview/preview-directory.tsx`

- [ ] `dir-table-body` 容器 `onMouseDown` 启动框选；行标识 `data-rowindex` → `row.getValue("path")`
- [ ] 框选 overlay 渲染（同 M2 样式）
- [ ] `selectedPaths.size > 0` 时显示 `N selected`（位置：目录头状态区，实现时定）
- [ ] `directoryKeyDownHandler` 加 `Cmd:a` / `Ctrl:a` → 全选 `allRows`（排除 `dotdotRow`）

**明确不动**：`copyPreviewFileItems` / `cutPreviewFileItems` / `handleFileDeletes` / 右键菜单 / `PreviewFileClipboard` / Esc / 双击 forceNewBlock。

`preview-directory` 相关测试

- [ ] 若已有该文件的单测则补 Ctrl+A 与框选接入用例；若无，只做手动验收并在报告里说明

## M5 — 验收

```bash
npx vitest run frontend/app/util/selectionrect frontend/app/view/aisessions frontend/app/view/preview
npx eslint frontend/app/util/selectionrect.ts frontend/app/view/aisessions frontend/app/view/preview/preview-directory.tsx
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aisessions|preview|selectionrect"
```

手动验收（真实库，Electron）：

**AI Sessions**
1. Ctrl 连点 3 行 → 批量栏显示 3 → Copy IDs 粘贴得 3 行
2. 空白处拖拽扫 8 行 → 8 行全选；Ctrl+拖拽追加
3. Shift+点击范围选
4. Ctrl+A 全选可见；Esc 清空
5. Ctrl+双击某行 → 新 Block 打开；双击 → 普通打开
6. 筛选后选区裁剪，批量栏数字同步变小
7. Star 3 条 → 刷新后仍是星标

**Files**
8. 目录表拖拽框选 → 右键 Copy 作用于整个选区
9. Ctrl+A 全选；选中计数显示
10. Delete / Ctrl+V / Esc 行为不回退

## 检查门

- [ ] 上述三条命令全绿
- [ ] `git status` 确认只碰本任务文件
- [ ] 无 `pkg/**` 改动
- [ ] `frontend/types/gotypes.d.ts` 未被改动
