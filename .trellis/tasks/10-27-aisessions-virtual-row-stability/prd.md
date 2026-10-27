# AISessions 虚拟行视觉稳定性（挂载动画 / 行高估算 / 滚动锚定）

## 背景

大会话详情虚拟化后，上下滚动时会看到「突然插入了一段文字」——内容在视口里跳一下、
新行白屏后淡入。这是**视觉稳定性**问题（不是主线程开销问题，性能整改见姊妹任务
`10-27-aisessions-scroll-perf`）。但两者共享同一批文件，实施时**必须先合性能任务
再合本任务**，否则会冲突。

### 成因 A：每个虚拟行重新挂载都重播 200ms 淡入上浮动画（主因）

`frontend/app/view/aisessions/session-message.tsx:375`

```tsx
className={cn("group scroll-mt-3 ly-enter", ...)}
```

`frontend/tailwindsetup.css:299`

```css
@keyframes ly-fade-up { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.ly-enter { animation: ly-fade-up 200ms ease-out; }
```

全量渲染时该动画只在打开会话时播放一次，是刻意的落盘过渡。虚拟化后，滚出视口的行
被卸载、滚回来重新挂载 → **每次重新进入视口都白屏一下再淡入**。
`tool-group.tsx:66` 的 `ly-enter` 同理。

### 成因 B：所有行共用 96px 估算，与真实行高差 2~4 倍

`timeline-virtual.ts:23` `EstimatedRowHeight = 96`，
`session-detail.tsx:1153` `estimateSize: () => EstimatedRowHeight`。

真实行高分布：user 气泡约 70~110px、tool 行约 40px、assistant markdown 段落 200~800px。
误差越大，滚动时的补偿性错位越明显（虽有
`shouldAdjustScrollPositionOnItemSizeChange`，`virtual-core:586`，但 96→400 这种
4 倍误差补偿不彻底，会留一帧可见错位）。

### 成因 C：浏览器 scroll anchoring 与 virtualizer 争抢 scrollTop

滚动容器 `session-detail.tsx:1752` 没设 `overflow-anchor: none`。行高被重测时，
浏览器自己的滚动锚定会再调一次 `scrollTop`，与 virtualizer 的 `scrollAdjustments`
叠加 → 「一顿一顿」。

## 目标

1. 滚动时不再有任何行做挂载淡入；新行直接以最终状态出现。
2. 未测量行的估算高度误差从 4 倍降到 1.4 倍以内。
3. 滚动锚定只由 virtualizer 一处负责。
4. 非虚拟化路径（≤60 行小会话）观感完全不变——`ly-enter` 落盘过渡保留。

## 非目标

- 不动 `measure()` 调用时机、memo、滚动事件处理（属姊妹任务）
- 不改虚拟化阈值与 overscan
- 不改 `AnimatedExpand`（工具/思考展开过渡）本身

## 约束

1. 文件域：`timeline-virtual.ts`、`session-detail.tsx`、`session-message.tsx`、
   `tool-group.tsx`，如需全局规则再动 `tailwindsetup.css`。
2. 估算逻辑必须是**纯函数**并配单测（不依赖 React / DOM）。
3. `prefers-reduced-motion` 的既有降级行为不得回退。

## 实施方案（要点）

### 1. 虚拟路径禁用挂载动画

- `MessageCard` / `ToolCallRow` / `ThinkingDisclosure` 新增 `animateIn?: boolean`（默认 `true`），
  条件拼接 `ly-enter`。
- `session-detail.tsx` 传 `animateIn={!virtualEnabled}`。
- 备选（若不想扩散 prop）：行容器加 `data-no-anim="1"`，用 CSS
  `[data-no-anim] .ly-enter { animation: none; }` 一次性覆盖。**优先选此备选**——
  改动更少、不改变组件 props 契约。

### 2. 按行类型估算行高

`timeline-virtual.ts` 新增纯函数：

```ts
export function estimateTimelineRowHeight(item: SessionDetailTimelineItem): number;
```

- `kind === "tool"` → 44
- `message.role === "user"` → 56 + 估算换行数 × 20，上限 260
- 其余（assistant）→ 40 + 估算换行数 × 19，上限 900
- 换行数粗估：`Math.ceil(textLength / charsPerLine)`，`charsPerLine` 按字体取 90

`session-detail.tsx`：`estimateSize: (index) => estimateTimelineRowHeight(renderItems[index])`
（保留 `EstimatedRowHeight` 作为兜底常量，供 `scrollTargetForSeq` 使用）。

### 3. 关闭浏览器 scroll anchoring

滚动容器加 `style={{ overflowAnchor: "none" }}`（或 Tailwind 类 `[overflow-anchor:none]`）。

## 验收标准

- [ ] 虚拟化路径下滚动，新进入视口的行无 `ly-fade-up` 动画（DevTools 检查无 `.ly-enter` 生效
      或动画被覆盖）。
- [ ] ≤60 条消息的会话仍然有落盘淡入过渡（视觉无变化）。
- [ ] `estimateTimelineRowHeight` 单测覆盖 user / assistant / tool / 空文本 / 超长文本。
- [ ] 滚动实测：往上滚 500px 再滚回来，视口内容漂移 < 8px。
- [ ] `npx vitest run frontend/app/view/aisessions` 全绿。
- [ ] 搜索跳转 / 批注跳转 / 大纲 active / 自动置底 全部正常。

## 依赖

- 必须在 `10-27-aisessions-scroll-perf` 合并后再实施（同文件冲突）。
