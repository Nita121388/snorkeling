# Block Sidebar — 暂存 Block 的常驻 Icon 列

## 背景

当前 `MinimizedBlocksFloat` 以浮动按钮 + Popover 的形式暂存 Block：
- 需要点击才展开，不直观
- Popover 遮挡内容，操作链路长
- 无法一眼看到所有暂存的 Block

用户期望：改为**常驻 Icon 列**（类似 PS 工具条），始终可见、一目了然，支持固定/隐藏。

## 目标

将 `MinimizedBlocksFloat` 从「浮动按钮 → Popover」改为「常驻 Icon 侧栏」：

```
固定态（pinned = true）：                     隐藏态（pinned = false, hovered = false）：
内容被挤压，侧栏常驻                          侧栏不可见，内容占满

┌──┬────────────────────────────┐      ┌──────────────────────────────┐
│💼│                            │      │                              │
│📄│      Block 内容区域         │      │      Block 内容区域           │
│💬│                            │      │                              │
│──│                            │      │                              │
│⚙ │                            │      │                              │
│＋│                            │      │                              │
└──┴────────────────────────────┘      └──────────────────────────────┘
 ↑                                    鼠标移到左侧边缘时：
 常驻 icon 列                          ┌──┬──────────────────────────┐
                                       │💼│                          │
 hover 态（pinned = false）：           │📄│   Block 内容区域           │
 侧栏浮出，内容不被挤压                  │💬│                          │
                                       │──│                          │
┌──┬────────────────────────────┐      │⚙ │                          │
│💼│                            │      │＋│                          │
│📄│   Block 内容区域            │      └──┴──────────────────────────┘
│💬│                            │       ↑
│──│                            │       hover 浮出（overlay 模式）
│⚙ │                            │       不占布局空间
│＋│                            │
└──┴────────────────────────────┘
 ↑
 浮出的 overlay，不挤压内容
```

## Icon 列布局

```
┌──┐
│💼│  ← 暂存的 Block icon（按最小化顺序排列）
│📄│
│💬│
│──│  ← 分隔线
│⚙ │  ← 设置（固定/隐藏切换）
│＋│  ← 快捷操作（新建 Block 等，可选）
└──┘
```

**支持收纳整个 Blocks 组**：

```
单个 Block → 单个 icon
Blocks 组  → 文件夹式 icon，展开后显示组内所有 Block

┌──┐
│💼│  ← 单个 Block
│📄├──────────────┐
│ 📄 tab1        │  ← Blocks 组（可展开/折叠）
│ 💬 tab2        │
│──│              │
│⚙ │              │
└──┴──────────────┘
```

每个 Block icon：
- 显示 Block 的 icon（terminal → `fa-terminal`，chat → `fa-comments` 等）
- Hover 显示 Tooltip（Block 标题 + 路径）
- 点击恢复 Block 到布局
- 右键菜单：恢复 / 预览 / 删除 / 移除

## 交互模式

### 1. 固定态（Pinned）
- 侧栏**占据布局空间**（左侧 w-12），内容区域被挤压
- 始终可见，不受 hover 影响
- 右键菜单或底部 ⚙ 按钮可取消固定

### 2. Hover 态（Unpinned）
- 侧栏**不占布局空间**，浮在内容上方（overlay）
- 鼠标移到左侧边缘 → 侧栏滑出
- 鼠标离开 → 延时收起（1200ms，同 WidgetsBar）
- 侧栏内 hover → 保持展开

### 3. 隐藏态（Hidden）
- 侧栏完全隐藏，左侧边缘无触发区域
- 通过 Tab 右键菜单 / 快捷键 / Settings 恢复
- 适用于「暂存列表为空时自动隐藏」或「用户主动隐藏」

## 与 WidgetsBar 的对称关系

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

## 状态持久化

| 状态 | 存储位置 | 说明 |
|------|---------|------|
| pinned | `localStorage: snorkeling:blockSidebarPinned` | 固定/取消固定 |
| hidden | `localStorage: snorkeling:blockSidebarHidden` | 完全隐藏/恢复 |
| position | 不需要 | 固定在左侧（或支持用户配置左/右） |
| 暂存 Block 列表 | workspace meta `tab:minimizedBlockIds` | 已有，不变 |

## 实现计划

### Phase 1: 替换浮动按钮为 Icon 列
- [ ] 新建 `BlockSidebar` 组件，替换 `MinimizedBlocksFloat`
- [ ] 复用 `block-minimize.ts` 的数据层（`getMinimizedBlockIds`, `restoreMinimizedBlockToLayout` 等）
- [ ] Icon 列渲染：遍历 minimizedBlockIds，每个渲染一个 icon 按钮
- [ ] Hover Tooltip：显示 Block 标题 + 路径
- [ ] 点击恢复：调用 `restoreMinimizedBlockToLayout`
- [ ] 右键菜单：恢复 / 预览 / 删除
- [ ] **支持收纳整个 Blocks 组**：inline-tab group 最小化时，整个组作为文件夹式 icon 存入侧栏
- [ ] 组展开/折叠：点击组 icon 展开显示组内所有 Block

### Phase 2: 固定/隐藏模式
- [ ] 实现 `pinned` 状态（参考 WidgetsBar 的 `loadWidgetsBarPinned`）
- [ ] 固定态：侧栏占 w-12 布局，内容被挤压
- [ ] Hover 态：overlay 浮出，不占布局
- [ ] 自动收起计时器（1200ms）
- [ ] 底部 ⚙ 按钮：固定/取消固定

### Phase 3: 隐藏模式
- [ ] 实现 `hidden` 状态
- [ ] 隐藏时：侧栏完全不渲染，无触发区域
- [ ] 恢复入口：Tab 右键菜单 / 快捷键 / Settings
- [ ] 空列表自动隐藏（可选）

### Phase 4: 拖拽定位（可选，后续）
- [ ] 支持用户拖拽侧栏到左侧或右侧
- [ ] 位置持久化到 localStorage
- [ ] 与 WidgetsBar 的位置互斥（不能同时在同一侧）

## 关键文件

| 文件 | 作用 |
|------|------|
| `frontend/app/block/minimized-blocks-float.tsx` | **重写** → `block-sidebar.tsx` |
| `frontend/app/block/block-minimize.ts` | 数据层，**不变** |
| `frontend/app/block/block.scss` | 样式，**重写** `.minimized-blocks-*` |
| `frontend/app/tab/tabcontent.tsx` | 渲染入口，**改引用** |
| `frontend/app/workspace/widgets.tsx` | 参考 pinned/hover 模式 |

## 视觉规范

- 宽度：42px（与 WidgetsBar 一致）
- Icon 尺寸：18px
- 背景：`bg-modalbg/85 backdrop-blur-xl`（与 WidgetsBar 一致）
- 圆角：`rounded-r-xl`（左侧栏）/ `rounded-l-xl`（右侧栏）
- 阴影：`shadow-2xl`
- 过渡动画：`transform 200ms ease-out, opacity 200ms ease-out`
