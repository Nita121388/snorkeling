# Inline Tab Block 标签溢出优化设计方案

> 状态：**已落地**（活动标签加宽 + 最大宽度 = block 宽度百分比 + 超长内容内部横向滚动）
> 创建时间：2026-09-07
> 相关组件：`InlineTabBlock`（`frontend/app/block/block.tsx`）
> 当前问题：当标签数量过多时，标签被挤压得看不出内容

## 问题分析

### 现状
1. **布局结构**：
   - 标签行 = `[tabs 滚动区 flex:1][加号固定区 flex:none]`
   - `.inline-tab-block-tabs` 有 `overflow-x: auto`，支持横向滚动
   - 每个标签 `.inline-tab-block-tab` 有 `flex: 0 1 auto`，可被压缩

2. **当前行为**：
   - 标签过多时显示水平滚动条
   - 非活动标签可能被截断（显示省略号）
   - 活动标签也可能被压缩，无法显示全称
   - 鼠标悬浮时 `max-width: 360px`，但可能仍然不够

3. **用户痛点**：
   - 标签太多时，活动标签也被压缩，无法看清内容
   - 需要滚动才能找到目标标签
   - 缺乏快速导航到任意标签的方式

### 根本原因
- 当前设计优先考虑空间效率，但忽略了可读性
- 没有为活动标签提供特殊保护
- 缺乏快速导航机制

## 设计目标

1. **活动标签全称显示**：当前打开的Tab必须显示完整标题，不被截断
2. **快速导航**：鼠标悬浮在标签行时，显示下拉弹窗列出所有Tab，支持点击切换
3. **向后兼容**：保持现有功能（拖拽、右键菜单、状态点等）
4. **性能**：不影响渲染性能，避免不必要的重绘

## 解决方案

### 方案概览
采用"活动标签保护 + 下拉导航菜单"的组合方案：

1. **活动标签保护**：确保活动标签始终显示全称
2. **下拉导航菜单**：在标签行末尾添加下拉按钮，或鼠标悬浮在标签行时自动显示
3. **智能截断**：非活动标签在空间不足时智能截断

### 详细设计

#### 1. 活动标签保护机制

**CSS 修改**：
```css
.inline-tab-block-tab.active {
  flex: 1 1 auto; /* 活动标签优先扩展 */
  min-width: 120px; /* 保证最小宽度 */
  max-width: none; /* 移除最大宽度限制 */
  flex-shrink: 0; /* 不允许收缩 */
}

.inline-tab-block-tab:not(.active) {
  flex: 0 1 100px; /* 非活动标签可收缩，最大100px */
  max-width: 100px; /* 截断长标题 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

**JavaScript 逻辑**：
- 计算容器可用宽度
- 优先分配空间给活动标签
- 剩余空间平均分配给非活动标签
- 如果空间不足，非活动标签显示省略号

#### 2. 下拉导航菜单

**触发方式**（两种可选）：
1. **悬浮触发**：鼠标悬浮在标签行任意位置时，显示下拉菜单
2. **按钮触发**：在标签行末尾添加下拉按钮（与"+"按钮并列）

**菜单内容**：
- 列出所有标签，按顺序排列
- 当前活动标签高亮显示
- 每个标签显示：
  - 图标（与标签图标一致）
  - 标题（完整显示）
  - 状态点（如有）
  - 快捷键提示（可选）

**交互**：
- 点击标签切换到对应块
- 支持键盘导航（上下箭头）
- 支持搜索过滤（可选，标签很多时）

**UI 设计**：
```
┌─────────────────────────────────┐
│ [Tab1] [Tab2] [Tab3] [Tab4] [▼]│  ← 标签行
├─────────────────────────────────┤
│ ▼ 所有标签                      │  ← 下拉菜单
│ ┌─────────────────────────────┐ │
│ │ 📁 Tab1                     │ │
│ │ 📁 Tab2                     │ │
│ │ 📁 Tab3 (当前)              │ │
│ │ 📁 Tab4                     │ │
│ │ 📁 Tab5                     │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

#### 3. 智能截断算法

```typescript
function calculateTabWidths(
  containerWidth: number,
  tabs: TabInfo[],
  activeTabId: string
): Map<string, number> {
  const widths = new Map<string, number>();
  
  // 1. 活动标签优先
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (activeTab) {
    widths.set(activeTab.id, Math.min(activeTab.title.length * 8, containerWidth * 0.4));
  }
  
  // 2. 剩余空间分配给其他标签
  const remainingWidth = containerWidth - (widths.get(activeTabId) || 0);
  const otherTabs = tabs.filter(t => t.id !== activeTabId);
  const widthPerTab = Math.min(100, remainingWidth / otherTabs.length);
  
  otherTabs.forEach(tab => {
    widths.set(tab.id, widthPerTab);
  });
  
  return widths;
}
```

## 实现步骤

### 阶段一：活动标签保护（1-2天）
1. 修改 CSS，确保活动标签不被截断
2. 添加 JavaScript 逻辑计算标签宽度
3. 测试各种标签数量下的显示效果

### 阶段二：下拉导航菜单（2-3天）
1. 设计下拉菜单组件
2. 实现悬浮/按钮触发逻辑
3. 添加键盘导航支持
4. 与现有拖拽、右键菜单集成

### 阶段三：优化与测试（1-2天）
1. 性能优化（避免频繁重绘）
2. 边界情况测试
3. 用户体验优化

## 技术细节

### 组件结构
```tsx
<InlineTabBlock>
  <div className="inline-tab-block-tabsrow">
    <div className="inline-tab-block-tabs">
      {tabs.map(tab => (
        <InlineTabLabel 
          key={tab.id}
          isActive={tab.id === activeTabId}
          width={tabWidths.get(tab.id)}
          // ... other props
        />
      ))}
    </div>
    <div className="inline-tab-block-addzone">
      <InlineTabGroupAddButton />
      <TabDropdownMenu tabs={tabs} activeTabId={activeTabId} />
    </div>
  </div>
  <div className="inline-tab-block-active">
    <SingleBlock ... />
  </div>
</InlineTabBlock>
```

### 状态管理
- 使用 `useMemo` 缓存标签宽度计算结果
- 使用 `useResizeObserver` 监听容器大小变化
- 使用 `useState` 管理下拉菜单的显示状态

### 样式隔离
- 新样式添加到 `block.scss` 的 `.inline-tab-block` 作用域内
- 使用 CSS 变量保持主题一致性
- 确保不影响其他组件

## 边界情况

1. **只有1个标签**：不显示下拉菜单按钮
2. **活动标签标题很长**：设置最大宽度限制（如容器宽度的40%）
3. **所有标签都很长**：活动标签优先，其他标签显示省略号
4. **窗口大小变化**：重新计算标签宽度
5. **拖拽标签**：下拉菜单中实时更新顺序

## 用户体验优化

1. **动画**：下拉菜单出现/消失使用平滑动画
2. **快捷键**：支持 `Ctrl+Tab` 切换到下一个标签
3. **搜索**：标签很多时支持输入过滤
4. **最近使用**：在下拉菜单顶部显示最近使用的标签
5. **固定标签**：支持固定常用标签到左侧（可选功能）

## 测试用例

1. **功能测试**：
   - 活动标签显示全称
   - 下拉菜单正确列出所有标签
   - 点击切换正常工作
   - 键盘导航正常

2. **边界测试**：
   - 1个标签、5个标签、10个标签、20个标签
   - 窗口最小宽度下的显示
   - 超长标题的截断处理

3. **性能测试**：
   - 大量标签下的渲染性能
   - 下拉菜单的响应速度

## 风险评估

1. **兼容性**：需要测试不同屏幕尺寸和分辨率
2. **性能**：标签宽度计算可能影响性能（使用防抖优化）
3. **可访问性**：确保下拉菜单支持屏幕阅读器
4. **现有功能**：确保不影响拖拽、右键菜单等现有功能

## 替代方案

### 方案A：固定宽度标签
- 所有标签使用固定宽度（如120px）
- 优点：实现简单，布局稳定
- 缺点：浪费空间，长标题仍被截断

### 方案B：可滚动标签 + 导航箭头
- 在标签行两侧添加左右箭头
- 优点：保持现有布局
- 缺点：不解决快速导航问题

### 方案C：标签折叠菜单
- 标签过多时折叠成"更多"按钮
- 优点：节省空间
- 缺点：需要额外点击

**推荐方案**：采用当前设计的组合方案，平衡了可读性和导航效率。

## 后续优化

1. **标签分组**：支持按类型分组（终端、编辑器、预览等）
2. **标签搜索**：支持模糊搜索标签
3. **标签预览**：鼠标悬浮显示内容预览
4. **多窗口标签同步**：跨窗口标签状态同步

## 相关文档

- [Inline Tab Add Menu 原型](../design/prototypes/inline-tab-add-menu/README.md)
- [Block 组件实现](../frontend/app/block/block.tsx)
- [Block 样式实现](../frontend/app/block/block.scss)

## 待确认事项

1. 下拉菜单的触发方式（悬浮 vs 按钮）？
2. 下拉菜单是否需要搜索功能？
3. 活动标签的最大宽度限制？
4. 是否需要支持标签固定功能？
5. 键盘快捷键的具体设计？

## 落地实现记录（用户已确认）

用户确认的方案聚焦**当前打开的标签（active）**：

- **更宽以显示更多信息**：活动标签保持内容自适应（`width: auto` / `flex: 0 1 auto`），但 `max-width` 由写死 `320px` 改为 `var(--inline-tab-active-max-width, 45%)` —— 上限 = block 容器宽度百分比（默认 45%，可配置）。
- **不能过大**：`max-width` 用百分比相对 `.inline-tab-block-tabs` 容器（≈整 block 宽）解析，随 block 宽度缩放，不写死 px。
- **超长内容内部滚动**：活动标签标题不再省略号截断，改为**跑马灯自动水平往返滚动**（像广告/ticker，`overflow: hidden` + 内容 `translateX` 循环 `alternate`，hover 时暂停方便阅读）。
- **宽度根据 Block 宽度**：活动标签 `max-width` 用百分比相对 `.inline-tab-block-tabs` 容器（≈整 block 宽）解析，随 block 宽度缩放，不写死 px；内容超出该宽度上限时触发跑马灯。
- **非活动标签**：保持现状（紧凑、内容自适应、`max-width: 320px`、hover 撑开到 360、省略号）。

**新增配置项**：`block:inlinetabactivemaxwidthpct`（float，默认 45，范围被钳制到 10–100）。

**改动文件**：`pkg/wconfig/settingsconfig.go`、`pkg/wconfig/defaultconfig/settings.json`、`docs/docs/config.mdx`、`frontend/app/block/blockenv.ts`、`frontend/app/block/block.tsx`、`frontend/app/block/block.scss`（并 `task generate` 同步 `frontend/types/gotypes.d.ts`、`pkg/wconfig/metaconsts.go`、`schema/settings.json`）。