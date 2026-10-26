# Files 树节点悬浮展示文件信息 Tooltip

## Goal

Files Block 的**目录树视图**里，鼠标悬浮在某个节点上超过一定时长后，弹出一张信息 Tooltip，
展示该文件/目录的基础信息（大小、最后修改时间、完整路径、类型）。Tooltip 的视觉遵循
shadcn/ui **Nova** 风格：柔和描边、大圆角、层次分明的排版、克制的入场动效，
并且**不破坏树行的虚拟滚动布局**。

## Context

- Files Block 有两种目录展示模式：**table**（`preview-directory.tsx`，已有 `Size` / `Last Modified` 两列）
  和 **tree**（`preview-explorer.tsx` → 共享 `frontend/app/treeview/treeview.tsx`）。
- 目前 **tree 模式没有任何元信息**，用户想知道某个文件多大、什么时候改的，只能切到 table 模式。
- 数据源现成：`FileInfo` 已带 `size`（字节）与 `modtime`（unix ms），只是 `TreeNodeData` 没透传。

## Requirements

### R1 悬浮触发

- 鼠标悬浮树节点 **≥ 700ms** 后才出现 Tooltip（hover-intent）。
- 快速划过不触发；未达到时长就移开则不出现。
- 指针移出节点后 Tooltip 立即（或极短延迟后）消失。
- 延迟常量集中定义，与既有 hover-intent 常量同处一个模块。

### R2 展示内容

Tooltip 至少包含：

- **头部**：文件图标 + 文件名（过长截断）+ 类型徽章（由 mimetype 推导的可读类型，如 `Markdown`、`JSON`）。
- **元信息行**：
  - `大小` —— 文件字节数（人类可读，如 `4.2 KB`）；目录不显示该行。
  - `最后修改` —— 人类可读时间（同年显示 `9月 15 14:32`，跨年显示 `2025-12-31`）。
- **路径**：完整绝对路径，等宽字体、自动换行、弱化颜色。
- 数据缺失（无 `size` / 无 `modtime` / `notfound` / `staterror`）时**不显示空行**，
  而是把该行整条省略；节点处于错误态时显示错误说明。

### R3 视觉设计（Nova 口味）

- 表面：`bg-modalbg` 半透明 + `backdrop-blur` + `border-border/70` 1px 描边 + `rounded-xl` + `shadow-2xl`。
- 排版：标签用弱化色小字（10–11px、轻微字距），值用前景色；行间距宽松。
- 分隔线：header / 元信息 / 路径之间用低对比 1px 分隔线分层。
- 动效：入场 `opacity + scale(0.96→1)` 约 120ms，出场更快；跟随鼠标行自动避让边界（flip/shift）。
- 层级：Tooltip 在 `FloatingPortal` 中渲染，`pointer-events-none`，不拦截点击。

### R4 不破坏既有行为

- TreeView 的虚拟滚动（`@tanstack/react-virtual` 绝对定位行）布局不变。
- **不得**为行节点包一层额外 DOM（现有 `element/tooltip.tsx` 会包 div，不能直接复用）。
- 树行的点击 / 双击 / 右键菜单 / 框选 / 重命名 / 键盘导航行为不变。
- 其他 `TreeView` 使用方（如预览页 treeview.preview）不受影响。

### R5 兼容

- `TreeNodeData` 新增字段全部**可选**，既有构造点无需改动即可编译通过。
- 表格视图行为不变。

## Acceptance Criteria

- [ ] 悬浮树节点 700ms 后出现 Tooltip，能看到文件名、类型、大小、最后修改时间、完整路径。
- [ ] 快速划过节点不会弹出 Tooltip。
- [ ] 指针移出后 Tooltip 消失。
- [ ] 目录节点与文件节点的展示内容分别正确（目录不显示字节大小）。
- [ ] 数据缺失时不出现空白行/空白占位。
- [ ] Tooltip 贴近屏幕边缘时自动翻转避让，不被裁切。
- [ ] 树行的点击、双击、右键菜单、框选、重命名、键盘导航全部保持原行为。
- [ ] 虚拟滚动行布局无回归（无额外包裹节点，行高/缩进不变）。
- [ ] `TreeNodeData` 新增字段为可选，既有 `TreeView` 消费方零改动编译通过。
- [ ] 新增单测覆盖元信息行构造与格式化（大小 / 时间 / 类型 / 缺失分支）。
- [ ] `vitest` 相关测试通过；`tsc` 无类型错误；`prettier` / `eslint` 无新增问题。

## Out of Scope

- 表格视图（已有两列）不改动。
- 不做 tooltip 内可交互元素（纯展示，`pointer-events-none`）。
- 不做「文件名被截断才显示」的差异化策略（本版始终显示）。
- 不做目录条目数统计（需要额外 RPC 往返）。

## Notes

- 相关文件：
  - `frontend/app/treeview/treeview.tsx`（共享 TreeView，行渲染）
  - `frontend/app/treeview/treeview-file-tooltip.tsx`（新增）
  - `frontend/app/view/preview/preview-explorer.tsx`（`toTreeNode` 透传 size/modtime）
  - `frontend/app/element/hover-timing.ts`（共享 hover-intent 延迟常量）
  - `frontend/util/fileformat.ts`（新增叶子模块，收敛 size/时间格式化）
- 影响面分析（GitNexus `impact`）：
  - `TreeNodeData` → LOW（2 个直接消费方：`preview-explorer.tsx`、`treeview.preview.tsx`）
  - `toTreeNode` → LOW（唯一调用方 `fetchDir`）
