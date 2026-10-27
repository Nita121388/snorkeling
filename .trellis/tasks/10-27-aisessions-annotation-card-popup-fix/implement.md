# Implement — AnnotationCard 关闭与边界截断修复

## 前置

- 包：`snorkeling-docs`（frontend）
- 目标文件：`frontend/app/view/aisessions/annotation-rail.tsx`
- 测试：`frontend/app/view/aisessions/annotation-rail.dom.test.tsx`

## 步骤

1. **状态补充**
   - 新增 `bodyScrollTop` state；`bodyRef` 加 `onScroll`（canSpread 时也安全）。
   - 新增 `bodyOffsetTop` state；用 `useLayoutEffect` 读取 `bodyRef.current.offsetTop`，并在 `collapsed/items.length` 变化时刷新（与现有 ResizeObserver effect 合并）。

2. **关闭态复位**
   - `onClose` 改为：`clearTimers(); setPinnedIndex(null); setOpenIndex(null); setHoverIndex(null);`。

3. **卡片渲染上提**
   - 删除 dot 包裹层内的 `{isCardOpen && ... <annotation-card wrapper>}` 块。
   - 在 rail 根节点末尾新增唯一卡片层（条件 `cardIndex != null && hoveredCluster != null`）：
     - `style={{ left: width, ...(placeBelow ? {top: dotTop} : {bottom: railHeight - dotTop}) }}`
     - `className="absolute z-50 "`（保留 `pl-2` 鼠标桥语义可用 `pl-2` 或给卡片自身留白）
     - 迁移原 `onMouseEnter/onMouseLeave` 逻辑到该层。
   - 计算 `dotTop / railHeight / placeBelow`，注意 `railHeight = bodyOffsetTop + bodyHeight`。

4. **注释固化约束**
   - 在 rail 根节点加注释：此节点必须保持 `position:relative; z-index>0`，**禁止** `overflow:hidden` / `transform`，否则悬浮卡会再次被裁切/压在聊天列下。

5. **测试**
   - 现有用例应保持通过（卡片仍在 `container` 内）。
   - 新增：
     - `it("Close fully closes the pinned card")`：钉住 → 点 `[aria-label="Close"]` → 卡片内 Accept 消失。
     - `it("card is not rendered inside the scroll body")`：断言卡片祖先不含 `bodyRef`（可用给 bodyRef 加 `data-testid="annotation-rail-body"`，断言 `card.closest('[data-testid="annotation-rail-body"]') === null`）。若不想加 testid，可断言卡片父级是 rail 根节点直接子节点。

## 验证命令

```bash
npx vitest run frontend/app/view/aisessions/annotation-rail.dom.test.tsx   # 12 passed
npx eslint frontend/app/view/aisessions/annotation-rail.tsx               # 0 error
npx tsc --noEmit -p tsconfig.json | grep annotation                       # 0 命中（仓库预存 81 条无关报错）
```

## 验证结果（2026-10-27）

- [x] 两处根因均在 diff 中可见修复（Close 复位全清三态；卡片上提到 rail 根节点、脱离 overflow/transform）。
- [x] 无新增依赖。
- [x] 既有 annotation-rail 测试 + 2 条新增用例全部通过（12/12）。
- [x] `git diff` 仅触及 `annotation-rail.tsx` 与其 `.dom.test.tsx` + 任务文档。

## 评审门

- [ ] 两处根因均在 diff 中可见修复。
- [ ] 无新增依赖。
- [ ] 既有 annotation-rail 测试 + 新增用例通过。
- [ ] `git diff` 仅触及 `annotation-rail.tsx` 与其测试（+ 任务文档）。

## 回滚点

- 单文件改动，`git checkout -- frontend/app/view/aisessions/annotation-rail.tsx` 即回滚。
