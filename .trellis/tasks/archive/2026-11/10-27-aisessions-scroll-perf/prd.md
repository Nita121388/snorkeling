# AISessions 详情滚动性能整改（虚拟化重测 / memo / 滚动事件）

## 背景

大会话（>60 条时间线行）详情走 TanStack 虚拟化后，滚动与流式输出期间主线程开销过高，
表现为「滚轮拖动一顿一顿」「流式时几乎滚不动」。

已定位三条真实 CPU 级成因（不是视觉问题，见姊妹任务
`10-27-aisessions-virtual-row-stability`）：

### 成因 1：流式期间每 32ms 清空整个行高缓存（最高开销）

`frontend/app/view/aisessions/session-detail.tsx:1186-1190`

```tsx
useEffect(() => {
    if (!virtualEnabled || liveTurn == null) return;
    virtualizer.measure();
}, [virtualEnabled, liveTurn, virtualizer]);
```

`liveTurn` 在 `use-live-turn.tsx` 里由 32ms flush 定时器每次产出**新对象**，因此该 effect
在流式期间以约 30 次/秒执行。`@tanstack/virtual-core@3.13.19` 的 `measure()` 实现
（`dist/esm/index.js:803`）是：

```js
this.measure = () => { this.itemSizeCache = new Map(); this.notify(false); };
```

即：清空全部已测行高 → `notify` → React setState → **整个 `session-detail.tsx`（约 2080 行）
重渲染** → 所有可见行重渲染 → 每行 `WaveStreamdown` 重新解析 markdown → 每行
`ResizeObserver` 回读 `getBoundingClientRect()`（强制同步布局）。
等于每秒 30 次「整页重渲染 + 30 份 markdown 解析 + 30 轮强制同步布局」。

### 成因 2：`MessageCard` 的 `memo` 被内联 props 打穿（稳定开销）

`session-detail.tsx:1408`

```tsx
registerRef={(node) => { if (node) messageRefs.current[item.message.seq] = node; }}
```

每次 `renderTimelineItem` 执行都产生新函数 → `MessageCard` props 永不相等 → `memo` 完全失效。
`onOpenAnnotations` 同样是内联闭包，同理。

后果：任何一次父级渲染（滚动事件、流式 delta、大纲 active 变化）都会让所有可见行
（overscan 6 → 通常 8~12 行）重跑 `WaveStreamdown`（单条长消息 1~5ms）与
`useDomTextHighlight` effect。10 行 × 2ms × 30 次/秒 ≈ 600ms/s 主线程占用。

### 成因 3：滚动事件逐事件触发全组件重渲染 + 布局抖动

`session-detail.tsx:918-955` `handleDetailScroll` 在每个 scroll 事件里同步
`setShowJumpPill(...)`，并让 `activeSeqFromVirtualItems` 在渲染期重算。
滚轮一次可触发 3~8 个 scroll 事件，拖动可达 60~120/s。同时该 handler 读
`scrollTop/scrollHeight`，`measureElement` 又读 `getBoundingClientRect`，与 React 的
DOM 写入交错，构成典型 layout thrash。

## 目标

1. 流式输出期间不再发生全量行高重测；`getTotalSize()` 在整个 turn 内保持单调稳定。
2. 滚动/流式期间可见行的 markdown 不再重复解析（memo 生效）。
3. 滚动事件不再逐事件触发整页重渲染。
4. 非虚拟化路径（≤60 行小会话）行为与观感完全不变。

## 非目标

- 不改虚拟化阈值 `VirtualizeThreshold`、`VirtualOverscan`。
- 不改消息分块 / delta 拉取 / 搜索 / 批注 / Copy Context 的业务语义。
- 不做视觉层调整（挂载动画、行高估算、scroll anchoring 属于姊妹任务
  `10-27-aisessions-virtual-row-stability`）。
- 不引入新的虚拟化库或重写时间线渲染结构。

## 约束

1. 改动文件域仅限：`session-detail.tsx`、`session-message.tsx`、`timeline-virtual.ts`
   （及其单测）。若必须越界，先更新本 PRD 的文件域清单。
2. 遵守 `.trellis/spec/snorkeling-docs/frontend/{hook-guidelines,state-management,type-safety}.md`。
3. 纯逻辑（可测部分）必须放进无 React/DOM 依赖的模块并配 vitest 单测。
4. 不得降低功能：搜索跳转、批注跳转、大纲 active、自动置底、底部 delta 追加、
   子代理卡片归位、live turn 渲染全部保持可用。

## 验收标准

- [ ] 流式输出进行中，`virtualizer.measure()` 不再被反复调用；`measure()` 只在
      「liveTurn 由无变有」「turn 结束 liveTurn 变为 null」两个边界各触发至多一次。
- [ ] 流式期间滚动：`getTotalSize()` 不再塌陷到估算值（可在 onScroll 中打点验证）。
- [ ] `MessageCard` 收到的 `registerRef` / `onOpenAnnotations` 在父组件重渲染时保持同一引用
      （用单测断言：父级状态变化不引起子组件渲染计数增加）。
- [ ] 一次滚轮手势（多帧）只触发一次 `setShowJumpPill` 相关重渲染。
- [ ] `npx vitest run frontend/app/view/aisessions` 全绿；新增单测覆盖成因 1、2 的回归。
- [ ] 手动验证：打开 >200 条消息的会话，流式输出期间上下滚动无明显卡顿；
      打开 ≤60 条消息的会话，行为与改动前一致。
