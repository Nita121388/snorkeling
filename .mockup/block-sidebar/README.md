# Block Sidebar — 暂存 Block 的常驻 Icon 列

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/block/minimized-blocks-float.tsx, frontend/app/block/block-minimize.ts
> 最后同步：2026-08-31
> Obsidian 方案：draft/snorkeling打磨-整理v1.md → UI 优化（通用）→ Block Sidebar
> 设计文档：design-plans/block-sidebar.md

---

## 背景

当前 `MinimizedBlocksFloat` 以浮动按钮 + Popover 的形式暂存 Block：
- 需要点击才展开，不直观
- Popover 遮挡内容，操作链路长
- 无法一眼看到所有暂存的 Block

用户期望：改为**常驻 Icon 侧栏**（类似 PS 工具条），始终可见、一目了然，支持固定/隐藏。

## 核心设计

### 三种模式

```
固定态（pinned = true）：                     隐藏态（hidden = true）：
内容被挤压，侧栏常驻                          侧栏不可见，内容占满

┌──┬────────────────────────────┐      ┌──────────────────────────────┐
│💼│                            │      │                              │
│📄│      Block 内容区域         │      │      Block 内容区域           │
│💬│                            │      │                              │
│──│                            │      │                              │
│◀ │                            │      │                              │
└──┴────────────────────────────┘      └──────────────────────────────┘

Hover 态（pinned = false）：
侧栏浮出，内容不被挤压（overlay）

┌──┬────────────────────────────┐
│💼│                            │
│📄│   Block 内容区域            │
│💬│                            │
│──│                            │
│◀ │                            │
└──┴────────────────────────────┘
 ↑
 浮出的 overlay，不占布局空间
```

### Icon 列布局

```
┌──┐
│💼│  ← 暂存的 Block icon（按最小化顺序排列）
│📄│
│💬│
│──│  ← 分隔线
│◀ │  ← 折叠侧栏（固定态）/  展开侧栏（hover态显示在边缘）
└──┘
```

固定态常驻显示 `◀` 折叠按钮；未固定/隐藏时，左边缘显示一个小尺寸的 `▶` 展开条（宽12px，高40px，实心背景）。

### 支持收纳整个 Blocks 组

```
单个 Block → 单个 icon
Blocks 组  → 文件夹式 icon，展开后显示组内所有 Block

┌──┐
│💼│  ← 单个 Block
│📄├──────────────┐
│ 📄 tab1        │  ← Blocks 组（可展开/折叠）
│ 💬 tab2        │
│──│              │
│◀ │              │
└──┴──────────────┘
```

### 最小化入口

正常布局中的 Block 通过以下方式落入 BlockBar（**替代旧的 `Minimize to Float` 浮动按钮**）：

- **标题栏按钮**：Block 标题栏 hover 时显示 `—` 最小化按钮，点击即最小化到侧栏
- **右键菜单**：右键 Block → `Minimize to BlockBar`

> 旧的设置菜单中的 `Minimize to Float` 已移除，不再隐藏到浮动按钮，统一收纳到 BlockBar。

### 交互

| 操作 | 效果 |
|------|------|
| 点击 Block 标题栏 `—` | 最小化 Block 到侧栏 |
| 右键 Block → Minimize to BlockBar | 最小化 Block 到侧栏 |
| Hover icon | Tooltip 显示 Block 标题 + 路径 |
| 点击 icon | 恢复 Block 到布局 |
| 右键 icon | 恢复 / 预览 / 删除 |
| 点击组 header | 展开/折叠组内 Block |
| 右键组 header | **恢复整个组到布局** / 预览组内所有 Block / 删除组 |
| 点击 `◀` | 折叠侧栏（进入 hover 态） |
| 点击展开条 `▶` | 恢复侧栏显示 |

### 状态持久化

| 状态 | 存储位置 | 说明 |
|------|---------|------|
| pinned | `localStorage: snorkeling:blockSidebarPinned` | 固定/取消固定 |
| hidden | `localStorage: snorkeling:blockSidebarHidden` | 完全隐藏/恢复 |
| 暂存列表 | workspace meta `tab:minimizedBlockIds` | 已有，不变 |

### 与 WidgetsBar 的对称关系

```
         左侧                              右侧
    ┌──────────┐                      ┌──────────┐
    │Block     │                      │Widgets   │
    │Sidebar   │  ← 新实现            │Bar       │  ← 已有
    │(暂存Block)│                      │(启动器)   │
    └──────────┘                      └──────────┘

    模式相同：
    - pinned → 占布局，常驻
    - unpinned → overlay，hover 浮出
    - 自动收起计时器
    - 右键菜单固定/取消固定
```

## 原型文件

- `block-sidebar.html` — 可交互原型（模式切换 / 组展开 / Tooltip / 右键菜单 / 删除确认）
- `INTERACTIONS.md` — 完整交互设计（Hover 行为层级 / 预览浮窗 / 删除确认方案 / 批量操作 / 键盘快捷键 / 状态转换图）

## 实现计划

### Phase 1: 替换浮动按钮为 Icon 列
- [ ] 新建 `BlockSidebar` 组件，替换 `MinimizedBlocksFloat`
- [ ] 复用 `block-minimize.ts` 数据层
- [ ] Icon 列渲染 + Hover Tooltip + 点击恢复 + 右键菜单
- [ ] 支持收纳整个 Blocks 组（inline-tab group 最小化）

### Phase 2: 固定/隐藏模式
- [ ] pinned 状态（参考 WidgetsBar）
- [ ] Hover 态 overlay 浮出
- [ ] 自动收起计时器（1200ms）
- [ ] 底部 ⚙ 按钮

### Phase 3: 隐藏模式
- [ ] hidden 状态
- [ ] 恢复入口：快捷键 / Settings
- [ ] 空列表自动隐藏（可选）

### Phase 4: 拖拽定位（可选，后续）
- [ ] 支持拖拽到左侧或右侧
- [ ] 位置持久化

## 关键文件

| 文件 | 作用 |
|------|------|
| `frontend/app/block/minimized-blocks-float.tsx` | **重写** → `block-sidebar.tsx` |
| `frontend/app/block/block-minimize.ts` | 数据层，**不变** |
| `frontend/app/block/block.scss` | 样式，**重写** `.minimized-blocks-*` |
| `frontend/app/tab/tabcontent.tsx` | 渲染入口，**改引用** |
| `frontend/app/workspace/widgets.tsx` | 参考 pinned/hover 模式 |
