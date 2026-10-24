# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

(To be filled by the team)

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

### 1. A changed `key` disposes the subtree — view-model constructor side effects re-run

`frontend/app/block/block.tsx` renders the active inline tab with a changing key:

```tsx
<BlockInner key={activeBlockId + ":" + viewType} … />
```

`BlockInner`'s `useEffect(…, [])` cleanup calls `unregisterBlockComponentModel(blockId)` +
`viewModel.dispose()`. So **switching inline tabs, magnifying, or switching workspace/tab
back disposes and re-creates the view model** — the constructor runs again.

Consequence: any constructor side effect that is meant to happen **once** (usage counting,
analytics, registration, "first open" bookkeeping) will silently run again on every re-mount.

Real example: the Files path-hub recorded a preview block's initial path from the
`PreviewModel` constructor. Merely toggling between inline tabs inflated that path's use
count, which promoted it into the "Frequent" list without the user re-opening anything.

Fix pattern — keep the effect but gate it on a **stable identity** that survives the remount
(the block id, never the model instance), and only keep the claim when the effect actually
succeeded:

```ts
const initialRecordedBlockIds = new Set<string>();

export function recordInitialPathUsage(blockId, path, kind, connection?) {
    if (!claimInitialPathRecord(initialRecordedBlockIds, blockId)) return;
    if (!recordPathUsage(path, kind, connection)) {
        initialRecordedBlockIds.delete(blockId); // let a later mount retry
    }
}
```

Keep genuinely *event-driven* work ungated: the path-hub's `metaFilePath` subscription
(real navigation) calls the ungated `recordPathUsage`, so navigation still counts.

**How to check before adding a constructor side effect**: grep the component for its `key`
and for the unmount cleanup, then ask "can this component unmount without the user doing the
thing I'm counting?". See `frontend/app/block/block.tsx` (`SingleBlock` / `InlineTabBlock`),
`frontend/app/view/preview/path-usage-store.ts`,
`frontend/app/view/preview/preview-model-path-usage.test.ts`.

### 3. Block InfoCard：分派只在一处，新增类型只加分支

Block 悬浮卡的唯一分派点是 `frontend/app/block/block-info-card.tsx` 的 `BlockInfoCard()`，
被 inline tab / block frame header / sidebar / Tab 卡分类四处复用。新增一类卡片的正确做法：

1. 在 `frontend/app/block/block-info-card-meta.ts` 加**纯函数**判定（可单测、不 import React）；
2. 在 `BlockInfoCard()` 按「Note → Preview → SessionDetail → Chat → Agent → null」顺序插分支；
3. 不要改 `isAgentTerminalMeta` 的语义（它是 HIGH 风险符号，5 个直接调用方）——
   用 `isAgentCardMeta` 这类**超集** helper 在卡片层做并集判定。

会话类 block 的 id 解析统一走 `resolveBlockSessionId(meta)`：
`aisessions:sessionid` → `agent:sessionid` → `resolveAgentSessionId(meta)`。
**不要只看 `agent:sessionid`**：GUI Chat / 会话详情 block 的权威 id 在 `aisessions:sessionid`，
漏掉会让 note/tags 请求根本不发出去。

### 4. 会话 note/tags：数据只走 session-note-cache，草稿必须有 dirty

- note/tags 的唯一真相源是 `frontend/app/store/session-note-cache.ts`；
  跨界面同步靠 `aisession-note-updated` 事件 + 缓存 TTL 刷新，不要在卡片里各自发 RPC。
- 可编辑草稿一律用 `useSessionNoteState`（`frontend/app/store/session-note-hook.ts`）：
  `dirty` 未置位时**禁止**自动保存。反例：草稿只在 `[sessionId]` 变化时初始化，
  summary 异步到达后草稿仍是 `""`，3 秒防抖把空串写回，**清空真实备注**。
- 展示优先用 `summary.note`，编辑态才用草稿；否则首屏会显示 "Click to add a note..." 的假空态。
- 事件匹配要归一化 `StableKey`（`<source>:<id>:<path>`、远端 `remote:<b64>` 段）与裸 id，
  不能用 `===` 硬比。

### 5. Testing module-level mutable state

When a module keeps state at module scope (buffers, debounce timers, `Set`/`Map` claims),
a test must re-import a **fresh module instance** per case (`vi.resetModules()` + dynamic
`import()`), otherwise cases leak into each other. See
`frontend/app/view/preview/path-usage-store.test.ts`.

### 6. 浮窗里的长列表：限高 + 内部滚动，浮窗本身不滚

浮窗（floating window）里如果有一段会随数据变长的列表（路径列表、目标列表、
vendor 列表……），契约是 **header / scrollable content / footer** 三段式
（`docs/design-system.md` §Modal, Popover, and Menu）：

- 根节点：`flex flex-col` + 明确的 `max-height` 上限；
- 列表段：`flex-1 min-h-0 overflow-y-auto overscroll-contain` + 自己的 `max-h` 上限；
- header / 芯片区 / footer：`shrink-0`。

两个反例：

1. **根节点不是 flex 容器** → 溢出量不会被列表吸收，浮窗一路长到视口高，
   然后由 floating-ui `size` middleware 的内联 `overflowY:auto` 兜底 →
   变成**整个弹窗滚动**（标题、芯片、footer 一起滚走）。
   正确形态见 `frontend/app/view/preview/preview-new-files.tsx`（路径中枢）。
2. **列表不加 `overscroll-contain`** → 列表滚到底后滚轮继续外溢到浮窗/页面，
   观感上还是「整个弹窗在动」。

注意 floating-ui `size` middleware 的 `apply` 写的是**内联样式**（压过 class）：
`elements.floating.style.overflowY = "auto"` 会让任何 `overflow-hidden` class 失效。
不要为了限高而给已经有内部滚动容器的浮窗引入 `size` middleware——
用 CSS 的 `max-h-[min(500px,calc(100vh-32px))]` 就够。


### 7. 虚拟滚动列表上的悬浮浮层：不能包裹 DOM，计时器必须共享

`frontend/app/treeview/treeview.tsx` 的行是 `@tanstack/react-virtual` 渲染的
**绝对定位**元素（`style.transform: translateY(...)`）。在行上挂浮层有三条硬规矩：

1. **不要用会包一层 `<div>` 的现成 Tooltip**（`frontend/app/element/tooltip.tsx` 就会包）。
   多包一层会改变行内 flex 布局与缩进。正确做法是浮层组件自己管 floating，
   由调用方把**行 DOM 节点**作为 reference 传进去，浮层只通过 `FloatingPortal`
   渲染一个绝对定位的兄弟节点。参考 `frontend/app/treeview/treeview-file-tooltip.tsx`。
2. **计时器整棵树共用一个**。行是虚拟滚动的，可能同时挂载几十行，
   每行一个 timer 会互相抢先把浮层指向别的行。计时逻辑抽成
   `createHoverIntentController`（`frontend/app/treeview/use-hover-intent.ts`），
   纯函数、无 DOM 依赖，可以用 fake timers 做确定性单测。
3. **行被回收时浮层要能自愈**：滚动会销毁行 DOM，锚点失效 → 滚动时主动收起浮层。

另外，虚拟列表里的行**不要留原生 `title`**：浏览器原生 tooltip 会和浮层重叠，
把「完整名字」的职责交给浮层（浮层里显示全名 + 路径）。

### 8. 浮层入场动画：先渲染隐藏态，再翻到可见态

浮层带着终态（`opacity: 1`）挂载时，浏览器没有「变化前样式」，`transition`
**不会触发**——动画看起来完全没发生。正确顺序：

- 首次渲染用隐藏态（`opacity: 0` / `scale: 0.96`）；
- 下一帧（`requestAnimationFrame`）再切到可见态，`transition` 才会跑起来。

出场要「延迟卸载」：淡出动画跑完后才把 DOM 摘掉，否则元素直接消失、没有过渡。
两段式关闭（`onClose` 触发淡出 → `onUnmount` 摘 DOM）见
`createHoverIntentController` 的 `pointerLeave()`。

缩放动效用**独立的 `scale` CSS 属性**，不要写 `transform`——floating-ui 用
`transform` 做定位translate，写 `transform: scale(...)` 会把定位顶掉。

### 9. floating-ui `shift` 默认只约束交叉轴

`shift({ padding: 12 })` 默认只在**交叉轴**（垂直方向）上回拉，主轴（水平）溢出
指望 `flip()` 兜底。但当两侧都放不下时，`flip()` 会维持原位 → 浮层溢出视口被裁切。
需要「无论如何不出屏」时用 `shift({ padding: 12, crossAxis: true })`，
让主轴也被拉回视口内（树面板贴屏幕边缘时的真实场景）。

### 10. 悬浮卡的关闭必须有「点击外侧」这条路径

InfoCard（`frontend/app/element/info-card/`）的显示由 `isHovered || isCardHovered` 这类
**hover/focus 状态**驱动，不是点击打开。三条关闭路径缺一不可：

1. `mouseleave` → 延迟隐藏；
2. 焦点离开卡片 → 指针已不在卡片上就隐藏；
3. **document 级 `pointerdown` 落到卡片与触发元素之外 → 立即关闭**
   （`useInfoCardDismiss`，`info-card-hover.tsx`）。

第 3 条不是锦上添花：卡片内有 textarea / 按钮时，`onFocusCapture` 会把卡片
「钉住」（`cardFocusRef = true`），此时 `mouseleave` 直接 return 不排隐藏定时器；
若再没有点击外侧兜底，`onBlurCapture` 只把 `cardFocusRef` 复位、不排隐藏，
卡片就会**永久停留**，只能重新 hover 一次再移开才消失。

配套两条约束：

- **钉住期间不要因 `mouseleave` 关卡片**：否则在 note textarea 里打字、鼠标顺手挪开，
  300ms 后卡片消失、编辑被打断。钉住状态只由「点击外侧」或失焦解除。
- **卡片可见性不要复用 header hover 高亮的状态**：header 高亮有 2000ms 延迟（给图标看），
  卡片跟着它走就会在指针离开后多挂 2 秒。两者用独立 state（`isCardOpen` / `isHovered`），
  卡片统一 300ms 收起。
- 关闭前如果焦点还在卡片内，先 `activeElement.blur()`：textarea 的 `onBlur`（note 提交）
  必须先跑，否则点外侧会丢草稿。

回归测试：`frontend/app/element/info-card/info-card-hover.dom.test.tsx`。
