# 设计：AISessions 详情滚动性能整改

## 1. 现状结构（阅读结论）

```
SessionDetail (session-detail.tsx, ~2080 行)
├─ renderItems            = timelineItems + liveTimelineItems，去掉已归位的 subagent 工具行
├─ virtualEnabled         = renderItems.length > 60
├─ useVirtualizer({ count, getScrollElement: () => detailScrollRef.current,
│                   estimateSize: () => 96, overscan: 6,
│                   measureElement: (el) => el.getBoundingClientRect().height })
├─ virtualItems           = virtualizer.getVirtualItems()
├─ activeOutlineSeq       = virtualEnabled ? activeSeqFromVirtualItems(...) : fullRenderActiveSeq
├─ renderTimelineItem     useCallback → MessageCard / ToolCallCard / SubagentCard
└─ 滚动容器 <div ref={detailScrollRef} className="h-full min-h-0 overflow-auto p-3 pb-10"
                 onScroll={handleDetailScroll} />
   └─ virtualEnabled ? 绝对定位行（transform: translateY(start)）
                     : renderItems.map(...)
```

关键事实：

| 事实 | 位置 | 影响 |
|---|---|---|
| 所有行共用 96px 估算 | `timeline-virtual.ts:23`、`session-detail.tsx:1153` | 误差 2~4 倍，测量补偿频繁 |
| 流式期间 `measure()` 30 次/秒 | `session-detail.tsx:1186` | 清空 `itemSizeCache`，量级开销 |
| `registerRef` / `onOpenAnnotations` 内联 | `session-detail.tsx:1408`、`session-detail.tsx:1391` | `MessageCard.memo` 失效 |
| `handleDetailScroll` 同步 setState | `session-detail.tsx:918` | 每 scroll 事件整页重渲染 |
| 行容器绝对定位 + `transform` | `session-detail.tsx:1790-1800` | 不能用 parent 的 scroll 偏移做缓存键 |

## 2. 方案

### 2.1 消除流式期间的 `measure()`（成因 1）

**决策：不是节流，是移除。** 流式期间行高变化交给 `measureElement` 的
`ResizeObserver` 逐行增量处理——库本身在 `measureElement` 里判断
`item.start < getScrollOffset() + scrollAdjustments`（`virtual-core:586`），
对位于视口上方的行做 `scrollAdjustments += delta` 补偿，这正是我们想要的行为。
全量 `measure()` 只会把这份精确增量信息丢掉。

改为边界触发：

```tsx
const liveTurnActive = liveTurn != null;
// 只在「有实时 turn」与「实时 turn 结束（落盘接管）」两个边界重测整表。
// 禁止依赖 liveTurn 对象本身：它每 32ms 换一个新引用（use-live-turn flush）。
useEffect(() => {
    if (!virtualEnabled) return;
    virtualizer.measure();
}, [virtualEnabled, liveTurnActive, virtualizer]);
```

风险与缓解：
- 若某行高度变化未被 `ResizeObserver` 捕获（例如 `AnimatedExpand` 高度过渡期间），
  库会在 `isScrollingResetDelay`（150ms）后重新 `calculateRange`，不会永久错位。
- `turn_end` 时 `liveTurn` 变为 null → 触发一次 measure → 正好把「流式行 → 落盘行」
  结构变化后的高度全量校准一次。

### 2.2 修复 `MessageCard.memo`（成因 2）

**实施时的修正（重要）**：`MessageCard` 用的是**自定义比较器**
（`session-message.tsx` 末尾），它逐项比较 props 引用，但**没有**比较 `registerRef`。
因此 `registerRef` 内联并不打穿 memo，真正的打穿点是 `onOpenAnnotations`
——它被加入了比较器，而父级每个带 `itemKey` 的消息都会传一个新的内联闭包。
（并且大多数历史消息都有 `itemKey`，所以影响面接近全量行。）

最终实现：把 `onOpenAnnotations` 的语义从 `() => void` 改成
`(seq: number, anchorKey: string) => void`，由父级用 `useCallback([])` + `annotationsRef`
提供**引用稳定**的函数；`MessageCard` 内部用自己的 `message.seq` / `message.itemKey`
拼出点击闭包（内部闭包不参与 memo 比较，无影响）。

`contextAttrs` / `contextText` 已经是稳定 Map 取值，无需处理；`children` 只有
subagent 卡片行会变，属于内容真实变化。

### 2.3 滚动事件 rAF 合并（成因 3）

`handleDetailScroll` 改为「只写 ref，rAF 内做一次 state 提交」：

```tsx
const scrollRafRef = useRef<number | null>(null);
const handleDetailScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;          // 本帧已排队
    scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        commitScrollState();                            // 读 scrollTop + setState 一次
    });
}, [commitScrollState]);
```

- `nearBottomRef` 仍在 rAF 回调里更新（它只被 `useEffect([liveTurn])` 的吸底逻辑读取，
  一帧延迟无影响）。
- 卸载时 `cancelAnimationFrame`。
- 底部 delta 请求的节流逻辑（`bottomDeltaRequestedRef` + 500ms timer）保持不变，
  只是移到 `commitScrollState` 内。

`activeSeqFromVirtualItems` 已在渲染期由 `virtualItems` 推导，不额外产生读布局，
无需再改；但为避免每次 scroll 渲染都重算，可把 `outlinePrompts` 的 fallback 查找
提到 `useMemo`。

### 2.4 强制同步布局治理

- `measureElement: (element) => element.offsetHeight`（等价于默认实现，但避免
  `getBoundingClientRect` 触发 transform 相关计算路径）。
- `handleDetailScroll` 内不再读 `node.scrollHeight`——虚拟化路径已用
  `virtualTotalSizeRef.current`（`session-detail.tsx:922`），保留。

## 3. 契约变化

| 位置 | 变更 |
|---|---|
| `MessageCard` props | `registerRef: (node) => void` → 保留，但由 `MessageCard` 内部生成（新增可选 prop `registerMessageRef?: (seq, node) => void`，与旧 `registerRef` 共存过渡；最终只留新的） |
| `handleDetailScroll` | 语义不变，时序由「同步」变「下一帧」 |
| `timeline-virtual.ts` | 若走备选方案则无新增导出；`estimateSize` 变更留给姊妹任务 |

## 4. 兼容与回滚

- 三个改动互相独立，可按 2.1 → 2.2 → 2.3 顺序分三次提交，任一环节出问题只回退该提交。
- 小会话路径（`virtualEnabled === false`）不经过 `measure()` 分支、不经过虚拟行容器；
  2.2 的 props 变更对小会话同样生效（是收益，不是风险）。
- 回滚点：每个 commit 单独可 revert，无数据/迁移影响。

## 5. 验证

1. 单测（vitest）：
   - `MessageCard` 稳定回调：父级 setState 后子组件渲染次数不增加（`session-message.dom.test.tsx` 新增用例）。
   - `handleDetailScroll` 一帧多次调用只提交一次（抽出可测的 `createScrollRafCommitter` 纯函数）。
2. 手动/CDP：
   - 打开 >200 条消息会话，`dev:cdp` 后用 `node scripts/inspect-electron-ui.mjs` 或 DevTools
     Performance 录制「流式输出 + 上下滚动」，确认 Layout/Recalculate 与 major GC 明显减少，
     commit 次数在纯滚动期间接近 0。
   - 断言 `getTotalSize()` 在 turn 内不塌陷（临时打点，验收后移除）。
3. 回归清单：搜索跳转、批注跳转、大纲 active、打开会话自动置底、底部 delta 追加、
   子代理卡片归位、live turn → 落盘交接无视觉断裂。
