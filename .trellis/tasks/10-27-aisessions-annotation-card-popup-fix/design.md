# Design — AnnotationCard 关闭与边界截断修复

## 根因（定位到行）

文件：`frontend/app/view/aisessions/annotation-rail.tsx`

### 缺陷 1：Close 不关闭

- 卡片显隐：`cardIndex = pinnedIndex ?? openIndex`（L190）。
- 钉住时鼠标通常已在卡片上，卡片 `onMouseEnter` 会再次 `setOpenIndex(index)`（L368 附近），于是 `openIndex === index`。
- `onClose={isPinned ? () => setPinnedIndex(null) : undefined}`（L382）**只清 `pinnedIndex`**，`openIndex` 仍在 → `cardIndex` 仍为 index → 卡片继续渲染；同时 `isPinned=false` 使 `onClose` 变 `undefined`，✕ 消失。

### 缺陷 2：边界截断

- 卡片由 dot 包裹层内渲染：`absolute left-full top-0 z-50`（L365），dot 包裹层 `top: topFor(index) + transform: translateY(-50%)`（L320）。
- dot 包裹层在滚动容器 `bodyRef` 内，`bodyRef` 样式 `overflowY: canSpread ? "visible" : "auto"`（L293）。CSS 规定一个轴非 visible 时另一轴 visible 计算为 auto → 节点多（`canSpread=false`）时卡片被 `bodyRef` 滚动容器**双向裁切**。
- `transform` 在 dot 包裹层创建**新层叠上下文**，把卡片 `z-50` 困在局部层；卡片贴着底部节点向下长，越界部分被聊天列/滚动区遮住，视觉即「边界截断」。

## 方案对比

- **A. Portal 到 body + position:fixed**：最彻底，但会改变卡片 DOM 归属，`annotation-rail.dom.test.tsx` 里大量 `container.querySelector` 断言需改为 `document` 级；并需处理 resize/scroll 重定位与外部点击关闭，改动面偏大。
- **B. 把卡片从滚动容器内「上提」到 rail 根节点渲染（选中）**：卡片不再处于 `bodyRef` 滚动裁切区、也不再处于 dot 包裹层 transform 层叠上下文；用 rail 根节点的绝对定位 + 相对坐标计算 + 垂直翻转夹取。DOM 仍在同一 React 组件树、仍在测试 `container` 内，既有断言基本不变。

选 **B**：最小结构改动同时解决两个根因，回归面小。

## 设计细节（方案 B）

### 结构变更

把 `{isCardOpen && hoveredCluster ...}` 这段卡片渲染从「每个 dot 的包裹层内」移出，改为在 rail 根节点（`<div className="relative z-10 flex shrink-0 flex-col ...">`）末尾渲染一个**唯一的卡片层**：

```
<rail root relative z-10>
  <header>Notes / AI / drafts</header>
  <bodyRef overflow={canSpread?visible:auto}> ...dots... </bodyRef>
  {cardIndex != null && hoveredCluster && (
     <div className="absolute z-50" style={{ left: width, top|bottom }}>
        <AnnotationCard ... />
     </div>
  )}
</rail root>
```

要点：
- 卡片层不再是 dot 包裹层子节点 → 脱离 `transform` 层叠上下文，`z-50` 在 rail 的 `z-10` 上下文内实际高于聊天列（聊天列为 z-auto 的定位元素，rail 为 z-10 → rail 整层绘制在上）。
- 卡片层不在 `bodyRef` 内 → 不受滚动容器 `overflow:auto` 裁切。

### 坐标计算

- 需要 dot 在 rail 根节点坐标系中的纵向中心：
  - `bodyOffsetTop`：`bodyRef.current.offsetTop`（bodyRef 是 `relative`，offsetParent 为 rail 根节点）。
  - `dotTop = bodyOffsetTop + topFor(cardIndex) - bodyScrollTop`。
  - `bodyScrollTop` 通过 `bodyRef` 的 `onScroll` 写入 state；`canSpread` 时不滚动恒为 0。
  - `bodyOffsetTop` 在 `useLayoutEffect` 里读取并存入 state（避免首帧 ref 为空）。
- 垂直翻转：设 `railHeight = bodyOffsetTop + bodyHeight`（rail 可用高）。
  - 若 `dotTop < railHeight / 2` → 卡片向下：`top = dotTop`。
  - 否则 → 向上：`bottom = railHeight - dotTop`。
  - 这样底部节点卡片向上生长，不会长出 rail 底部。
- 水平：`left = width`（rail 展开宽 44px）。卡片 `left-full` 语义等价于贴着 rail 右侧进入聊天列；rail 在最左，天然不会右侧越界。
- 卡片自身保持 `max-h-[60vh] overflow-y-auto`。

### 关闭态复位

`onClose`（仅钉住时提供）改为：

```
() => { clearTimers(); setPinnedIndex(null); setOpenIndex(null); setHoverIndex(null); }
```

保证卡片彻底关闭，且 ✕ 不会「残留」成半开。

### 交互保持

- 卡片层 `onMouseEnter` → `clearTimers(); setOpenIndex(cardIndex)`；`onMouseLeave` → 若钉住直接 return，否则 `closeTimer` 320ms 后关闭（逻辑从原包裹层平移过来）。
- dot 点击钉住/再点收起逻辑不变。
- dot 的 `transform: translateY(-50%)` 保留（不影响卡片，因为卡片已不在其子树内）。

## 兼容 / 回滚

- 纯前端渲染结构局部调整，无数据/RPC 变更。
- 回滚：还原 `annotation-rail.tsx` 单文件即可。

## 风险

- 低。唯一注意点：rail 根节点若日后加了 `overflow:hidden` 或 `transform` 会重新触发裁剪/层叠问题——在代码注释中固化「rail 根节点禁止 overflow:hidden/transform」的约束。
