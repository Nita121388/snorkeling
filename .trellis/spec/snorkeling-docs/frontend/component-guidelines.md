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

### 11. 视图根节点必须显式 `w-full`，否则浮窗里只占「内容宽」

`frontend/app/block/block.scss` 的 `.block-content` 是 `display:flex; width:100%`，
`BlockInner` 的视图组件是它的**直接 flex 子项**。`align-items` 默认 `stretch`
只作用于交叉轴（高度），主轴（宽度）默认按 `max-content` 收缩 —— 只写
`h-full` 的根节点会收缩成"最宽的那个子元素"的宽度。

真实事故：AI Audit 视图（`frontend/app/view/aiaudit/aiaudit-view.tsx`）根节点写的是
`flex h-full min-h-0 flex-col`，漏了 `w-full`；表格 `w-full` 于是等于自身 max-content
（≈660px）。以 ephemeral 浮窗（视口 80%）打开时，右侧 40%+ 宽度全空，且不报任何错误。

约定：

```tsx
// 视图组件根节点
<div className="flex h-full w-full min-h-0 flex-col bg-block-solid">
```

自检方法：`node scripts/inspect-electron-ui.mjs elements` 里比较视图根节点与
`.block-content` 的 `getBoundingClientRect().width`，两者应一致（误差 ≤ 2px）。
横向溢出交给内部 `overflow-auto` 容器，不要靠根节点收缩来"自适应"。

### 12. 虚拟化列表里的 `memo`：不要让会变化的回调进 props

`MessageCard`（`frontend/app/view/aisessions/session-message.tsx`）用自定义比较器
逐项比较 props 引用。它**不比较** `registerRef`（ref 回调天然每帧新建，比较只会误伤），
但会比较 `onOpenAnnotations`。

于是：父级 `SessionDetail` 每次渲染都传一个新的内联闭包 → 所有带 `itemKey` 的行
`memo` 全部失效 → 滚动事件（60~120/s）与流式 delta（~30/s）都会让每行重跑
`WaveStreamdown` 解析 markdown。单条长消息 1~5ms，10 行 × 30 次/秒 ≈ 600ms/s 主线程。

约定：

1. **`memo` 组件接收的回调必须引用稳定**：父级用 `useCallback` + `ref` 读最新状态，
   参数（seq / key）由子组件自己带上，而不是父级内联闭包捕获。
2. **需要 live 数据时用 ref 转发**，不要为了拿最新值把依赖写进 `useCallback`：
   ```tsx
   const dataRef = useRef(data);
   dataRef.current = data;
   const stableHandler = useCallback((id: string) => doWork(dataRef.current, id), []);
   ```
3. **写 `memo` 比较器时显式列出忽略项**：像 `registerRef` 这类每帧新建的回调，
   必须从比较器里排除，否则 memo 等于没开。
4. **虚拟化列表的自定义比较器是性能契约**，改动它要配一个「父级重渲染不引起子组件
   重渲染」的回归测试（参考 `session-message.dom.test.tsx` 的 `MessageCard memo contract`）。

同类坑：`@tanstack/react-virtual` 的 `virtualizer.measure()` 会**清空全部**
`itemSizeCache`。只有当「行集合发生结构性变化」（例如流式 turn 开始/结束）时才能调用；
把它挂在会高频换引用的对象（如每 32ms flush 的 `liveTurn`）上，等于每秒数十次
把所有行高退回估算值 —— 总高度塌陷、scrollTop 被 clamp、内容剧烈跳动。
流式期间的行高变化交给 `measureElement` 的 ResizeObserver 逐行增量处理。

### 5. InfoCard 变体：一张卡只保留一条「无内容间隔」的 hairline

`InfoCard` 的变体（`.tab-card` 等）常用 1px 分隔线切分区。踩过的坑：header 下方的
`.tab-card-rule` 与「属性 chips」区块的 `border-top` 在**无 agent 的卡片**里紧挨着出现，
中间没有任何内容 —— 视觉上是两条平行线，像渲染坏了。

规则：
- 卡片内固定只有 header 下一条分隔线；
- 下游分区（chips / 元数据）的上边框**必须条件渲染**：只有上游真的渲染了内容区块时才加
  （`tab-info-card.tsx` 用 `agentCount > 0 && "has-agents"` 控制，CSS 里 `.tab-card-props.has-agents`）。
- 判定「有没有上游内容」要在 TSX 里算，不要在 CSS 用 `:has()` / 相邻选择器猜 —— 分区的 DOM
  层级是 `section` 套 `section`，相邻选择器匹配不到真正的前序内容。

### 6. InfoCard 变体：定宽 + 状态 pill 不参与宽度竞争

Tab 悬浮卡的旧实现是 `min-width: 200px; max-width: 400px` 自适应，状态文本从 `—` 变成
`Tool: bash` 时卡片会突然变宽，悬停时视觉抖动。现在 `.info-card.tab-card` 定宽 268px，
右侧状态 pill 用 `margin-left: auto; flex-shrink: 0; white-space: nowrap` —— 长状态不会撑宽卡片。
新增同类浮层卡时照此办理：**宽度由卡决定，状态文本只决定 pill 自身宽度**。

---

## 共享浮层组件的交互扩展：就地内聚，不改宿主（2026-11-03, task 11-02-emoji-alias-picker-search）

`element/block-editor/components/emoji-picker.tsx` 被 5 个渲染点复用（`markdown.tsx` 4 处：
callout / 文档 emoji 头 / inline `:emoji` 补全 / slash emoji，以及 `agent-emoji-picker.tsx`）。
给它加新交互（右键设置 emoji 含义）时的做法，可复用到同类共享浮层：

1. **新增状态内聚在组件里**，宿主 props 一个都不加 —— 否则 5 个宿主都要改一遍，且容易漏。
2. **浮层内部换视图，不新开第二层浮层**：popover 已经按视口算过 `maxHeight` / 边界，
   嵌套 portal 需要第二套边缘计算，还会和宿主的 backdrop / 焦点逻辑打架。
3. **键盘事件要显式拦在浮层内**：宿主常在 `window` 上挂 `Escape → onClose`，
   子视图的 Esc 必须在自己的根节点 `preventDefault() + stopPropagation()`，
   否则「关子视图」会变成「关整个浮层」。
4. **右键入口同时提供键盘入口**（`ContextMenu` / `Shift+F10`）。
5. **`onMouseDown` 的 `preventDefault` 守卫要放行真实表单控件**：判断选择器是
   `input, textarea, select, label, button`，新加的可聚焦容器要么用这些标签，要么单独白名单，
   否则输入框点不动、失焦。

**陷阱**：给浮层里的列表项加 `onContextMenu` 时不要在 `document` 级捕获，
在格子自身挂监听并 `preventDefault() + stopPropagation()`，避免和宿主/浏览器原生右键菜单叠加。

---

## inline 编辑覆盖层：位置靠实测、高度只是下限（2026-11-03, task 11-03-md-list-inline-edit-geometry）

md 预览的 inline 编辑是一个 `createPortal` 到 `body` 的 `position: fixed` 覆盖层
（`element/markdown-inline-edit.tsx`）。它最容易出的两类 bug 是「一进编辑文字就跳」和
「内容被切掉」，原因都在几何取值方式上。

### 1. 覆盖层高度 = 渲染块高度是**下限**，不是定值

`overlayRect.height` 取自渲染块的 `getBoundingClientRect().height`。这个值有两个天然缺口：

- `getBoundingClientRect()` **不含 margin**，而编辑器内容里的 `<ol>/<li>` 有 margin；
- 内容会增长（多行、多列表项、用户继续换行）。

所以 overlay 必须是 `minHeight: overlayRect.height` + `height: auto`，
**不能** `height: 固定值`。同时 `overflow` 不能是 `hidden`、`contain` 不能带 `paint`
—— 两者都会把超出部分裁掉（`paint` containment 的裁剪最隐蔽，改 CSS 时容易漏）。

### 2. 文本起点要用 `Range` 实测，不能用「元素盒子 + padding」推算

`resolveTextOffsetPx()` 用 `Range` 覆盖第一个非空文本节点取 `rect.left`。盒子法在这些情况下会错：

| 锚点形态 | 盒子法误差 | 原因 |
|---|---|---|
| 整个 `<ol>`（条目带嵌套子列表时提升到父级） | 1.5px | 文本在 `li` 里，比 `ol` 多一层 `li.paddingLeft` |
| 折叠式有序列表项 | 13px | 序号是 `.ordered-list-summary-content::before` 内联绘制的，文本墨迹比盒子右移一个序号宽 |

### 3. 列表 marker 必须靠「左扩 overlay + 根 padding」腾位置

渲染态 marker 落在 `<li>` 左边缘**之外**（`ol` 的 margin/padding 区）。把 overlay 左边缘
锚在 `li.left` 时，任何画在文本左侧的 marker 都会落到覆盖层外被裁掉。可用恒等式：

```
overlay.left = anchorLeft + textOffset - markerColumn
root padding-left = markerColumn
第一层 ul/ol/li 的 margin/padding = 0
li::before { position: absolute; right: 100%; width: markerColumn }
⇒ overlay.left + root padding === anchorLeft + textOffset === 渲染态文本 x
```

`markerColumn` / `textOffset` 都从渲染态 computed / Range 实测，不写死 `1.5em`。

### 4. 折叠内容的块不能进 WYSIWYG

`buildListWysiwygSeed` 会解包 `.ordered-list-collapse-body`，于是阅读态被 `.collapsed`
隐藏的子内容在编辑器里突然出现（高度暴涨 + 内容被裁）；改成丢弃又会**在提交时丢数据**。
正确做法是 `captureWysiwygInfo` 早退返回 `null` → 回退 textarea 路径，源文本一字不改。

### 5. `whiteSpace: pre-wrap` 只属于 textarea

textarea 需要它保留源码换行；contentEditable 根节点继承它会把种子 HTML 里的空白文本节点
变成真实换行 → 多出空行、撑高、被裁。WYSIWYG 根节点用 `normal`（与渲染态一致）。

### 验证方式（别只靠肉眼）

组件预览页 `frontend/preview` 有 markdown 用例（含 editable 列表）。用 CDP 在编辑前后各取一次
第一个文本节点的 `Range` rect，断言 Δx/Δy ≈ 0，并断言 `overlay.scrollHeight <= clientHeight`。
把旧 CSS 注入回去做对照，应能重现 ~26px 的偏移 —— 这一步证明测量本身有效。

---

## 预览编辑的"机器可判定"验证闭环（2026-11-04, task 11-04-preview-edit-verify-harness）

用户的判据是"看起来对不对"，不是"数字对不对"。所以任何声称"样式已修好"的结论，
都必须能由脚本产出 **verdict + 证据**，而不是靠人工看图或口头断言。

### 1. 一条命令

```bash
node scripts/verify/preview-edit/run.mjs --expect=fixed            # 冷启动（重置 verify profile）
node scripts/verify/preview-edit/run.mjs --attach --expect=fixed   # 复用已起实例，单轮 <10s
node scripts/verify/preview-edit/run.mjs --expect=broken --legacy-css   # 证明实验台能抓到旧 bug
node scripts/verify/preview-edit/run.mjs --against=verify-runs/<ts>/report.json   # 收敛判据
```

产物：`verify-runs/<ts>/report.json`（机器读）、`report.md`（人读、内嵌截图）、每 case 的
`before / during / afterEsc / diff` 四张 png。

### 2. 三层 oracle

| 层 | 规则 | 判据 |
|---|---|---|
| 几何不变量 | `text-zero-shift` / `no-clip` / `single-level-indent` / `marker-drawn` / `clean-exit` | DOM Range 墨迹与 computed 值 |
| 像素自证 | `pixel-zero-shift` | 逐文本行比较"最左墨迹 x"（§3） |
| 契约 | `editor-kind` / `no-measure-loop` | 编辑器类型 & 调试环时序 |

### 3. 像素 oracle 为什么不需要 golden baseline

预览编辑的产品契约是"零布局位移"，所以**阅读态自己就是编辑态的基准**：
取同一个裁切区域，比较编辑前/编辑中每一行文字的**最左墨迹 x**。
它对字体抗锯齿、颜色、光标闪烁完全不敏感 —— 只测与 bug 直接相关的那个量。

两个必要细节（都踩过）：

- **必须剔除"镀层列"**：`inline-edit-active` 的 accent 竖条整列都是墨迹，
  会把所有行连成一条、并劫持"最左墨迹" → 列级墨迹占比 ≥ 0.8 的列一律跳过。
- **裁切必须紧贴块**：裁太高会把上下相邻段落也框进来，行带数量就失去意义。

### 4. 验证台自身的四个坑（都会导致假绿/假红）

1. **别在 mock 页面验证**：组件预览页没有真实主题变量、不是真实 `.md` preview 路径。
2. **别用合成事件**：`dispatchEvent(new MouseEvent(...))` 绕过命中测试；必须用 CDP
   `Input.dispatchMouseEvent`（且要 `Emulation.setFocusEmulationEnabled`，
   窗口在后台时真实指针事件进不到 React）。
3. **探针必须复刻 app 的锚点提升规则**：`li` 内含子列表时点击锚定父级 `ol/ul`；
   探针若还锚在 `li` 上，会量出 24px 的假偏移。
4. **目标要滚进视口再量**：文档很长时目标在折叠线以下，裁切会被夹成空白（行带 0、diff 0）。

### 5. 循环协议（agent 自我进化用）

```
run --expect=fixed → 读 report.json 的 failing[].id + detail → 只改一个变量
→ run --against=<上一轮>：newFailures 非空 = 这次改动是坏的，立即回退
→ 连续 3 轮无改善 → 停，把整个 verify-runs/<ts>/ 当证据包交给人
→ 修好后把该 bug 抽象成 rules/<new>.mjs，spec 里写明"为什么需要这条规则"
```

**rules 库只增不减**：每修一个 bug 就多一条常驻判据，覆盖面单调增长。

---

## Agent hover 卡属性行（PropertyList `layout="agent"`）

**`opacity: 0` 不等于「不占位」**。行内 hover 才出现的按钮（`property-row__dialog-btn` /
`property-row__menu-btn` / `property-row__delete`）如果仍留在 flex 流里，就会压缩同级
`width: 100%` 的值按钮，让该行值右缘比其它行少一个图标宽（实测 18px）。隐藏按钮必须
绝对定位到预留 gutter：

```scss
.property-list--agent {
    .property-row__value { padding-right: 18px; }        /* 统一右侧操作栏 */
    .property-row__dialog-btn,
    .property-row__menu-btn,
    .property-row__delete {
        position: absolute; right: 0; top: 50%; transform: translateY(-50%);
    }
}
```

**空值占位不要继承多行行的对齐**。`.property-row.is-note` 为多行 note 设了
`align-items: flex-start`（图标/标签对齐首行）；但空 note 的 `—` 是单行占位，套上
`flex-start` 会把 26px 行高的余量全推到下方，整行上浮约 6px、行距塌到 20px。用
`:has()` 只在非空时生效：

```scss
.property-row.is-note:has(.property-empty--dash) {
    align-items: center;
    .property-row__icon, .property-row__name { margin-top: 0; line-height: 26px; }
    .property-row__value { align-items: center; }
}
```

**验证方式**（不依赖手看）：`sass` 编译该 scss → Edge headless 渲染复刻 DOM →
PIL 扫描每行墨迹右缘与 label 中心 y。判定：四行 `value_right` 同一 x、行距恒定。
