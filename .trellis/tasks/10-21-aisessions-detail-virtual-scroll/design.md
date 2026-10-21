# 技术设计：详情虚拟滚动 + 子代理归位

## 1. 约束与取舍

消息卡片高度差异极大（一行文本 vs 带 markdown/thinking/工具输出的长消息），且展开/折叠会改变高度。
所以：

- **动态测量**（`measureElement`）+ 估算值兜底，不用固定行高
- **阈值切换**：`renderItems.length <= 60` 走现有全量渲染路径。小会话是绝大多数日常场景，
  保证它们的行为与改动前逐字节一致，把虚拟化的回归面限制在大会话上。
- **不引入新依赖**：`@tanstack/react-virtual@^3.13.19` 已在 `package.json`。

## 2. 数据流

```
effectiveDetail.messages
  → readableMessages (useMemo)
  → detailMessages (= readableMessages)
  → timelineItems (useMemo, buildSessionDetailTimeline)
  → renderItems (timelineItems + liveTimelineItems)
      ├── count <= 60 ──> 现有 renderItems.map（不变）
      └── count > 60 ───> useVirtualizer 渲染可见窗口
```

虚拟化分支在 `session-detail.tsx` 内以独立组件 `TimelineRows` 承接，避免把
500 行的主组件再撑大。

## 3. 虚拟化实现要点

```tsx
const virtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => detailScrollRef.current,
    estimateSize: () => 96,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
});
```

- 容器保留 `overflow-auto`，内部包一层 `position: relative; height: totalSize`，
  每行 `position: absolute; top: item.start`。
- `measureElement` 只在行挂载时调用一次；消息内容变化（live turn 更新）通过
  `virtualizer.measure()` 在 effect 里显式重测，避免无限循环。
- live turn 追加时若用户停在底部，保持 `scrollTop = scrollHeight`（现有逻辑保留）。

## 4. 滚动相关功能的等价改造

| 功能 | 现状 | 改造 |
|---|---|---|
| `scrollToVisibleMessage(seq)` | 查 `messageRefs.current[seq]` 节点 | 用 `seqToIndex` 映射 + `virtualizer.scrollToIndex({index, align:"start"})`，`scrollToIndex` 未测量时用 `initialOffset` 兜底（先 scrollToIndex 再在下一帧修正） |
| `messageRefs` | 每行写 DOM ref | 改为只给**可见区**的行写 ref（虚拟化后不可视节点本就取不到）；仍保留 key 语义 |
| `useActiveOutlineSeq` | `document.getElementById("aisession-message-<seq>")` 逐个比对 top | 改成按 `virtualizer.getVirtualItems()` 的 `index` 二分定位 active prompt（不可视节点直接跳过，取最后一个 `start <= probeY` 的可见项） |
| 自动滚到底 | `scrollTop = scrollHeight` | 虚拟化后 `scrollTo({top: virtualizer.getTotalSize()})` |
| nearBottom / 底部增量 | `scrollHeight - scrollTop - clientHeight` | 改用 `virtualizer.getTotalSize()`，语义不变 |

## 5. 子代理归位

`buildSessionDetailTimeline`（`session-timeline-sync.ts`）目前把 subagent tool call 摊平成
timeline item。改造：

- timeline item 的 `message` 项新增 `subagentMatches: SubagentMatch[]` 字段，
  由调用方（`session-detail.tsx`）在构建后按 `itemKey` 关联（不在纯函数里读服务）。
- 渲染时：`MessageCard` 内部渲染该消息最后一个子行 → `<SubagentCard>`（缩进子级）。
  为不破坏 `MessageCard` 的可测性，用 `children` 传入：`<MessageCard ...>{matches.map(...)}</MessageCard>`。
- 归位只对**折叠态**做结构变更；无匹配时父消息不渲染 children，行为与现状一致。

## 6. 子代理渐进加载（R4）

`SubagentCard` 展开流程：

1. 立即置 `loading=true` → 渲染 `<SessionDetailSkeleton rows={3} />`
2. 串行队列（模块级 `subagentLoadQueue`，并发 1）提交 `service.Detail({id, loadAll:true})`
   —— 走已有分帧契约，首帧 ≤512KB
3. 首帧到达即渲染，`HasMore` 为真时显示底部"加载更多"动画条，继续拉下一帧
4. `queueMicrotask`/卸载即取消：用一个 `requestSeq` 世代号丢弃迟到响应
5. 失败：保留已渲染内容 + `Retry` 按钮

优先级排序键：`子代理 = 低`（展开顺序越晚的越靠后），主时间线的 `DetailDelta` 不受队列影响。

## 7. 测试

新增：
- `timeline-virtual.test.ts`：`seqToIndex` 映射、阈值切换函数（`shouldVirtualize(count)`）、
  `activeSeqFromVirtualItems` 的大纲定位纯函数
- `subagent-queue.test.ts`：串行（同时提交 3 个 → 只有 1 个在飞）、取消（折叠后迟到响应被丢弃）、
  失败保留内容
- `subagent-card.test.tsx` 扩展：展开时渲染骨架而非纯文字

回归：`npx vitest run frontend/app/view/aisessions`（当前 143 passed 必须保持）。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 动态测量导致滚动跳动 | 只 `measureElement` 一次；live 更新显式 `measure()`；阈值 60 以下不启用 |
| `scrollToIndex` 未测量时定位不准 | 先 scroll 到估算位置，下一帧用真实 offset 修正（rAF 内做一次） |
| 大纲 active 定位偏差 | 纯函数单测覆盖"可见项全在目标上方/下方"两类边界 |
| 子代理串行队列饿死主加载 | 队列只承载子代理；主 `DetailDelta` 不经队列 |
