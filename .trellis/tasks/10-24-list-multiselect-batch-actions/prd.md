# PRD: 列表多选与批量操作 — AI Sessions 批量复制 + Files 框选

## 背景

用户希望「Ctrl 点击多选，进行批量操作（复制 session id、session file 等）」，并进一步要求支持**鼠标框选**。
调研后确认现状：

**AI Sessions**（`frontend/app/view/aisessions/`）
- 只有单选 `selectedKeyAtom`，无选区概念
- `onSelect(event)` 已带鼠标事件，但 Ctrl/Cmd+点击被「强制新开 Detail Block」占用
- 单行复制菜单已存在：Working directory / Session file path / Session ID / Resume command / Markdown（`session-menu.tsx:245-277`）
- 行容器已有 `data-session-key` / `data-depth`（`session-group.tsx:190`），可被框选取用
- **无任何框选实现**

**Files**（`frontend/app/view/preview/preview-directory.tsx`）
- 已有 `selectedPaths: Set<string>` + `selectionAnchorPath`
- 已有 Ctrl/Cmd toggle、Shift 范围选、Esc 清空
- 已有右键菜单感知选区（`contextSelectedFileInfos`，点已选行时菜单作用于整个选区）
- 已有 `Ctrl/Cmd+C` 复制选区、`Delete` 删除选区、`Ctrl/Cmd+V` 粘贴
- 双击已带 `forceNewBlock: e.ctrlKey || e.metaKey`（`preview-directory.tsx:616-620`）
- **缺**：鼠标框选、选中计数提示、Ctrl+A 全选

**仓库全局确认**：无任何 rubber band / marquee 框选实现；`altKey` 无任何视图使用（不存在 Alt+点击惯例）。

## 目标

### Phase A — AI Sessions 多选与批量复制

1. 多选：Ctrl/Cmd+点击切换、Shift+点击范围选、Ctrl+A 全选可见、Esc 清空。
2. 框选：列表空白处按下拖拽画出矩形，与矩形相交的行进入选区；Ctrl+框选追加。
3. 批量操作栏：选中 ≥1 条时在列表面板底部显示，提供批量复制与 Star/Unstar。
4. 手势迁移：**Ctrl+双击 = 强制新开 Detail Block**（接管原 Ctrl+单击），Ctrl+单击改为主选/多选切换。
5. 选区始终是「当前可见会话」的子集：筛选/刷新后按 key 裁剪，避免「复制 5 个 ID 但只剩 2 条在结果里」。

### Phase B — Files 补齐一致性

6. 框选：与 Phase A 同一套几何函数。
7. 选中计数提示：选中 ≥1 时显示条数。
8. Ctrl+A 全选当前可见行。
9. **不加批量工具栏** —— 右键菜单 + 快捷键已覆盖 Copy/Cut/Paste/Delete。

## 非目标

- 不做批量删除 / 批量 note / 批量标签（有破坏性或需新 RPC，另开任务）
- 不做跨块共享选区（AI Sessions 的选区是本 widget 局部态，与筛选一样不持久化）
- 不做行内 checkbox（用修饰键 + 框选，保持行简洁）
- 不改 Files 的剪贴板模型（`PreviewFileClipboard` 照旧）
- 不做 macOS 之外的平台差异化手势

## 决策

| # | 决策 | 取舍 |
|---|---|---|
| 1 | Ctrl+单击改为多选切换；「强制新开块」移到 Ctrl+双击 | 与 Files 双击分支既有的 `forceNewBlock: ctrl\|\|meta` 惯例一致；不发明 Alt |
| 2 | 框选用 DOM 矩形求交，不用虚拟列表索引 | AI Sessions 列表当前非虚拟滚动（`min-h-0 flex-1 overflow-auto`），行都在 DOM 里 |
| 3 | 4px 位移阈值区分「点击」与「框选」 | 低于阈值按点击走原逻辑，避免误触 |
| 4 | 框选几何函数放共享模块，两视图复用 | 避免两份实现漂移 |
| 5 | 批量栏只在选中 ≥1 时显示；1 条时右键菜单仍可用 | 1 条时工具栏噪音大于收益 |
| 6 | 批量 Star/Unstar 复用 `model.toggleMark`，逐个调用 | 无批量 RPC，先复用；慢再优化 |
| 7 | Files 不加批量工具栏 | 右键已全，重复建设 |
| 8 | 选区在筛选/刷新后按可见 key 裁剪 | 否则操作数与显示不符 |

## 用户故事

1. 作为用户，我 Ctrl 连点 3 条会话，底部出现「3 selected」和复制按钮，点 Copy IDs 后剪贴板是 3 行 id。
2. 作为用户，在列表空白处按下拖拽，扫过 8 行，松手后这 8 行全部选中。
3. 作为用户，Ctrl+框选在已有 3 条的基础上再加 4 条。
4. 作为用户，Shift+点击把从锚点到当前行的连续区间选中。
5. 作为用户，Ctrl+A 选中当前列表全部可见会话。
6. 作为用户，Esc 清空选区，或点 Clear。
7. 作为用户，Ctrl+双击某行，它在新 Block 中打开（原 Ctrl+单击行为）。
8. 作为用户，筛选后消失的会话不再算在选区内，批量栏数字同步变小。
9. 作为用户，在 Files 目录表里拖拽框选文件，右键菜单的 Copy/Cut/Delete 作用于整个选区（沿用既有逻辑）。
10. 作为用户，Files 里 Ctrl+A 全选当前目录，Esc 取消（Esc 已实现）。

## 验收标准

### Phase A

- [ ] Ctrl/Cmd+点击切换多选，同时把该行设为 `selectedKey`
- [ ] Shift+点击按可见顺序做范围选（锚点 = 上次单击行）
- [ ] Ctrl+A 全选当前可见会话；Esc 清空选区
- [ ] 空白处拖拽 ≥4px 进入框选；矩形相交行进入选区；Ctrl+拖拽追加
- [ ] 框选期间不触发行单击逻辑；松手后矩形消失
- [ ] Ctrl+双击 = 强制新开 Detail Block；双击 = 普通打开；单击不再开新块
- [ ] 批量栏在 ≥1 选中时显示，含选中计数与按钮：Copy IDs / Copy file paths / Copy working dirs / Copy resume commands / Star / Unstar / Clear
- [ ] 复制产物：每项一行 `\n` 连接；working dirs 去重；空输入返回 `""`
- [ ] 筛选/刷新后选区按可见 key 裁剪，批量栏计数同步
- [ ] 行视觉区分「单选高亮」与「在选区内」
- [ ] 窄窗口（≥700px）批量栏换行不溢出
- [ ] 单测：`buildBatchCopyText` 四种 kind、去重、空输入；`applySelectionRange` 正/反向/锚点失效；`pruneSelectionToVisible` 保留顺序；`keysUnderRect` 相交/不相交/部分相交
- [ ] lint / typecheck / 相关 vitest 全绿
- [ ] 手动验收：真实库 Ctrl 连点、框选、Ctrl+A、复制粘贴验证内容、Ctrl+双击新开块

### Phase B

- [ ] Files 目录表空白处拖拽框选，与 Phase A 同一几何函数
- [ ] 选中 ≥1 时显示计数（如 `3 selected`）
- [ ] Ctrl+A 全选当前可见行（含 `..` 上行的处理与既有行为一致）
- [ ] 既有 Ctrl+C / Delete / Ctrl+V / Esc / 右键菜单行为不回退
- [ ] 双击 Ctrl+开新块行为不回退（`preview-directory.tsx:616`）
- [ ] 单测覆盖共享几何函数在 Files 侧的接入
- [ ] 手动验收：真实目录框选、Ctrl+A、右键 Copy 作用于选区

## 里程碑

- M1 共享几何纯函数 + 单测
- M2 AI Sessions：选区 state、手势接入、Ctrl+双击迁移、裁剪
- M3 AI Sessions：批量操作栏 + 复制纯函数 + 单测
- M4 Files：框选 + 计数 + Ctrl+A
- M5 验收：lint / typecheck / vitest / 手动

> M3 开始前先过 M2 评审；M4 开始前先过 M3 评审。
