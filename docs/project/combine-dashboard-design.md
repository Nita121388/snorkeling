# Combine Dashboard（融合式仪表盘）设计文档

更新时间：2026-07-02  
状态：设计阶段

## 1. 背景

用户希望在 Wave Terminal 中实现一种特殊模式——将所有 tab 中正在运行的 **agent** 和 **terminal** 汇聚到一个统一视图中，方便集中查看和管理。这些 blocks 保持在其原有的 layout 位置中不变；组合视图作为一个独立的新 block，用户点击 Tab 栏按钮即可 toggle 开关。

### 关键设计演进

| 版本 | 方案 | 最终决策 |
|------|------|----------|
| V1 | 独立 Combine Dashboard（仅当前 tab） | ❌ 被否定 |
| V2 | Combine 与 Overview 联动（两个视图跳转） | ❌ 被否定 — 用户要求"**有机融合，而不是联动**" |
| V3 ✅ | Combine + Overview **融合为同一个面板** | ✅ 当前方案 |

## 2. 设计原则

### 核心思想

**Combine Dashboard 和 SessionOverview 不再是两个独立视图。它们是同一个面板的两个面 — 融合在一起。**

- 左侧面板同时承载"实时预览"和"全局会话管理"两种能力
- 数据源与 Overview 同源（跨所有 tab），使用相同的 `useOverviewBlocks(workspace)` hook
- 当前 tab 的 block 可以展开实时预览（SubBlock 嵌入 xterm.js）
- 非当前 tab 的 block 显示精简状态行（与 Overview 现有样式一致）
- 一个按钮，一个视图，无缝切换

### 融合面板的定位

| 维度 | 融合方案 |
|------|----------|
| 范围 | **跨 Tab** — 与 Overview 一样遍历所有 tab 的 blocks |
| 当前 Tab 的 block | 可展开实时预览（SubBlock 嵌入） |
| 其他 Tab 的 block | 精简状态行，点击跳转 |
| 数据源 | 与 Overview 完全一致（`useOverviewBlocks(workspace)`） |
| 排除列表 | localStorage 持久化，跨重启保留 |
| 过滤 | All / Agents / Terminals 三种视图 |

## 3. 交互规则

### 进入/退出
- 单击 Tab 栏按钮（位于 Note 与 Wave AI 按钮之间）→ toggle 打开/关闭面板
- 打开时按钮 active 高亮

### 面板布局
- **Header**：标题 + 统计信息（agents/terminals counts + tab count）+ 刷新/折叠按钮
- **过滤条**：All / Agents / Terminals 三种过滤，带计数
- **主体**：按 tab 分组的 block 列表
  - 当前 tab → 行可展开实时预览
  - 其他 tab → 精简状态行

### 行操作
- **当前 tab 的 block**：hover 时出现操作按钮，展开实时终端预览
- **非当前 tab 的 block**：仅显示状态摘要，点击可跳转
- **排除**：hover 时出现 ×，点击排除到 excluded 区，可恢复
- **跳转**：点击任意行 → 聚焦原始 block 并高亮

### 与 SessionOverview 的关系
- **不再存在独立的 SessionOverview 视图**
- 过滤条中的 Agents/Terminals 过滤替代了 Overview 的 `agentsOnly` 切换
- 所有 tab 的分组浏览替代了 Overview 的 `hideUnopenedTabs` 过滤
- 数据源复用 `useOverviewBlocks(workspace)`，无需重复开发

## 4. 实现方案

### 4.1 新文件

| 文件 | 内容 |
|------|------|
| `frontend/app/combinedashboard/combinedashboard-model.ts` | 单例模型，管理 isOpen、排除列表、跳转 |
| `frontend/app/combinedashboard/combinedashboard.tsx` | ViewModel + Panel（融合面板）+ Button |
| `frontend/app/combinedashboard/combinedashboard.scss` | 样式（参照 session-overview.scss 规范） |

### 4.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `frontend/app/block/blockregistry.ts` | 注册 `"combinedashboard"` → `CombineDashboardViewModel` |
| `frontend/app/block/blockutil.tsx` | 图标/名称映射 |
| `frontend/app/workspace/toggle-block.ts` | 常量 + FixedLeftBlockKindOrder |
| `frontend/app/tab/tabbar.tsx` | Note 与 Wave AI 之间插入按钮 |
| `frontend/app/tab/vtabbar.tsx` | 同上（vertical 版本） |

### 4.3 关键技术复用

| 技术 | 来源 | 用途 |
|------|------|------|
| `useOverviewBlocks(workspace)` | session-overview.tsx:246 | 跨 tab 获取所有 blocks |
| `useBlockControllerStatuses()` | session-overview.tsx:284 | 订阅 controllerstatus 事件 |
| `useCanonicalAgentStatuses()` | session-overview.tsx:342 | 订阅 agentstatus 事件 |
| `SubBlock` | block.tsx:596 | 实时终端预览嵌入 |
| `toggleCurrentTabBlockByKind()` | toggle-block.ts:208 | toggle 开关面板 |
| `BlockModel.setBlockHighlight()` | block-model.ts | 跳转高亮 |
| `refocusNode()` | global.ts | 跳转聚焦 |

### 4.4 排除列表持久化

```
localStorage key: "snorkeling:combine-dashboard:excluded-blocks"
格式: { tabId: [blockId, ...], ... }
```

## 5. 数据流

```
用户点击按钮 → CombineDashboardModel.open()
  → toggleCurrentTabBlockByKind(kind="combine")
    → 创建/隐藏 block（meta.view="combinedashboard"）
  → CombineDashboardPanel 渲染
    → useOverviewBlocks(workspace) 获取跨 tab blocks
    → 按 tabId 分组
    → 当前 tab → 展开实时预览（SubBlock 嵌入）
    → 其他 tab → 精简状态行
    → 过滤 excludedBlockIds（localStorage）
    → useBlockControllerStatuses / useCanonicalAgentStatuses 订阅推送

用户点击某行 → jumpToBlock(tabId, blockId)
  → setActiveTab(tabId) + BlockModel.setBlockHighlight() + refocusNode()
```

## 6. 验证方式

1. 启动 → Tab 栏出现 Dashboard 按钮
2. 点击 → 左侧面板显示所有 tab 的 agents 和 terminals
3. 当前 tab 的 block 可展开实时预览（终端内容实时更新）
4. 其他 tab 的 block 显示状态摘要
5. 点击任意行 → 跳转到原始 block 并高亮
6. 点击排除 → block 从面板消失，刷新仍保持排除
7. 新开 terminal → 面板自动出现新 block
8. 再次点击按钮 → 面板隐藏

## 7. 关联文档

- `.mockup/combine-dashboard.html` — 交互设计 mockup
- [Snorkeling 项目章程](snorkeling-project-charter.md)
- [Snorkeling 执行任务单](snorkeling-execution-plan.md)
