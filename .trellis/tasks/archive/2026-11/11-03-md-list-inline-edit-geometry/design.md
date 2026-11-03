# 设计：列表 inline-edit 几何与排版对齐

## 现状数据流

```
markdown.tsx  dblclick
  └─ resolveEditTargetFromEl()            → target(HTMLElement), line, blockKind="list"
       └─ beginEdit()                     → captureWysiwygInfo() → wysiwygHtml (种子)
            └─ measureOverlay()           → overlayRect {top,left,width,height}
                 └─ <InlineEditOverlay>   → createPortal 到 body，position:fixed
                      ├─ WysiwygEditor    (typography 快照 → 根节点 style)
                      └─ <textarea>       (typography 快照 + auto-grow)
```

`overlayRect` 是**唯一**的几何真相，两处消费者（overlay 的 style / measure 的去重比较）都读它。

## 关键设计决策

### D1 · 高度语义从「固定高」改为「最小高 + 内容自适应」

**决策**：overlay 的 `height` 改为 `auto`，原 `targetRect.height` 降级为 `minHeight`。

**理由**：`height: auto` 是 CSS 层能力，不需要 JS 参与测量，因此**不引入新的 measure 循环**
（这个组件历史上已经因为 measure 循环出过 scroll 抖动 bug，见 `measureOverlay` 里关于
`position: fixed` + 视口坐标的长注释）。textarea 路径的 auto-grow 已经算出内容高度并写进
`style.height`，父容器只要不限制就能装下。

**代价**：编辑多行内容时浮层会向下覆盖后续块。这是浮动编辑器的常规行为，用 `maxHeight`
（视口可用高度）+ `overflow: auto` 兜底。

**被否决的方案**：用 `ResizeObserver` 观测内容高度并回写 `overlayRect.height`。
否决原因：把几何真相拆成两处（CSS 的 auto 与 state 的 height），任何一方滞后都会产生一帧跳动；
且会重新引入 measure → state → re-render → measure 的环路风险。

### D2 · 列表缩进只保留一层，marker 用伪元素绘制

**问题**：typography 已经把 `<li>` 的 `paddingLeft` 给了 WYSIWYG 根节点，内层 `<ul>/<ol>`
又带 `margin-left: 1.5em`，形成双层缩进。

**决策**：三层分工，各管一件事。

两个**互相独立**的实测量，不能合并成一个：

- `listIndentPx`（marker 列宽）= 锚点所属 `ol/ul` 的 `computed.marginLeft + paddingLeft`
- `textOffsetPx`（文本在锚点内的偏移）= 第一个非空文本节点 `Range` 的左边缘 − 锚点 `left`

| 层 | 负责 | 具体值 |
|---|---|---|
| overlay 的 `left` | 让 marker 列有位置 | `targetRect.left + textOffsetPx - listIndentPx` |
| WYSIWYG 根 / textarea | 文本起点 | `paddingLeft = listIndentPx` |
| 内层第一层 `ul/ol` | **不贡献任何缩进** | `margin: 0; padding: 0; list-style: none` |
| 内层 `li` | 不贡献缩进与上下间距 | `margin: 0; padding-left: 0; position: relative` |
| 内层 `li::before` | 绘制 marker，占满 marker 列 | `position: absolute; right: 100%; width: var(--inline-edit-list-indent)` |

恒等式：`overlay.left + rootPadding = targetRect.left + textOffsetPx` —— 即编辑器文本起点
恒等于渲染态文本起点，与锚点是 `<li>` 还是整个 `<ol>` 无关。

**为什么 `textOffsetPx` 必须用 Range 量，不能用元素盒子 + padding**（两个实测反例）：

| 锚点形态 | 盒子法误差 | 原因 |
|---|---|---|
| 整个 `<ol>`（条目带嵌套子列表时提升到父级） | 1.5px | 文本在 `li` 里，比 `ol` 多一层 `li.paddingLeft` |
| 折叠式有序列表项 | **13px** | 序号是 `.ordered-list-summary-content::before` 内联绘制的，文本墨迹比盒子右移一个序号宽度 |

**为什么 `listIndentPx` 要减在 `left` 上而不是加在 padding 上**：渲染态 marker 落在 `<li>`
左边缘**之外**（`ol` 的 margin/padding 区）。overlay 左边缘锚在 `li.left` 时，任何画在文本
左侧的 marker 都会落在浮层边界外 → 被裁掉或压到左边。

**左边界保护**：`left` 最多只允许超出内容区左边缘一个 marker 列
（`max(left, renderRect.left - listIndentPx)`）——marker 列本来就住在那里，再多就越界了。

**嵌套层不受影响**：CSS 选择器只命中 `> ul, > ol`（直接子级），嵌套列表继续用渲染态的
`margin: 0.25em 0 0.25em 1.5em` 保留视觉层级。

**为什么必须左扩而不是把 marker 画在文本区内**：渲染态 marker 落在 `<li>` 左边缘**之外**
（在 `<ol>` 的 margin 区里）。浮层左边缘锚在 `li.left` 时，任何画在文本左侧的 marker 都会
落在浮层边界外 → 被裁掉或压到左边。左扩是唯一几何自洽的解。

**嵌套层不受影响**：CSS 选择器只命中 `> ul, > ol`（直接子级），嵌套列表继续用渲染态的
`margin: 0.25em 0 0.25em 1.5em` 保留视觉层级。

### D3 · marker 用伪元素而非原生 marker

渲染态折叠有序列表本来就是 `list-style-type: none` + `::before { content: counter(list-item) "." }`。
编辑器内沿用同一套绘制方式，数字的粗细（600）、颜色、`margin-right: 0.286em` 与阅读态一致，
从而消除"进编辑数字变样"的观感。

`counter(list-item)` 依赖 `list-style: none` 的元素仍然参与 list-item 计数 —— CSS 规范里
`display: list-item` 是计数前提，`list-style-type: none` 不影响 `counter(list-item)`。
所以 `<li>` 保持默认 `display: list-item` 即可（不改成 flex）。

### D4 · `whiteSpace: pre-wrap` 从 WYSIWYG 根节点移除

该属性是为 textarea 准备的（保留源码多行/行内空格）。contentEditable 根节点继承它以后，
种子 HTML 里的换行文本节点会变成真实换行 → 多出空行 → 撑高 → 加剧裁剪。

**决策**：`WysiwygEditor` 根节点不再强制 `pre-wrap`，改为 `normal`（与渲染态 `.markdown li/p` 一致）。
行内 `<br>` 由序列化器负责，不依赖 `pre-wrap`。

### D5 · 折叠项不进入 WYSIWYG（数据安全优先）

`buildListWysiwygSeed` 解包 `.ordered-list-collapse-body` 后会把隐藏的嵌套内容变成可见，
高度暴涨；若改为丢弃，commit 时嵌套内容丢失（源文件被改坏）。

**决策**：`captureWysiwygInfo` 在 `blockKind === "list"` 且 target（或其后代）带 `.collapsed`
时返回 `null` → 上层自动回退 textarea 路径（现有 fallback，无需新分支）。

**检测口径**：`targetEl.classList.contains("collapsed") || targetEl.querySelector(".collapsed") != null`。
宁可多回退（保守）也不能丢内容。

## 契约与类型

### 新增纯函数（可单测）

```ts
// markdown-inline-edit.tsx 导出
export type OverlayGeometryInput = {
    kind: InlineEditBlockKind;
    targetRect: { top: number; left: number; width: number; height: number };
    renderRect: { left: number; right: number; width: number } | null;
    viewportRect: { right: number };
    /** 列表 marker 占位宽度（px）；非 list kind 传 0 */
    listIndentPx?: number;
    /** 列表文本在锚点内的偏移（px）；非 list kind 忽略 */
    listTextOffsetPx?: number;
    /** 标题专用：文本起点（跳过 chevron 列）；非标题传 null */
    headingTextLeft?: number | null;
};
export type OverlayGeometry = { top: number; left: number; width: number; height: number };

export function resolveOverlayGeometry(input: OverlayGeometryInput): OverlayGeometry;
/** 锚点左边缘 → 第一个字符的偏移（Range 实测）。 */
export function resolveTextOffsetPx(targetEl: HTMLElement): number;
/** 锚点所属列表的 marker 列宽（computed margin+padding 实测）。 */
export function resolveListIndentPx(targetEl: HTMLElement, blockKind: InlineEditBlockKind): number;
```

把现在内联在 `measureOverlay` 里的 left/width/height 计算整体搬进这个纯函数，
`measureOverlay` 只负责取 rect + 调它 + 写 state。这样几何契约可被 jsdom 单测覆盖。

### 不变的契约

- `overlayRect` 的四个字段语义不变（top/left/width/height 均为视口坐标 + px）。
- `height` 字段继续存在，但消费端语义变为 `minHeight`；`measureOverlay` 的去重比较继续按四字段值比较
  （`height` 仍是"原块高"，不会因为内容增高而抖动 → 保留现有的防抖收益）。

## 兼容与回滚

- 全部改动集中在 3 个前端文件 + 1 个测试文件，无协议/存储变更。
- 回滚粒度：CSS（D2/D3/D4）与几何（D1/D5）互不依赖，可分别回滚。
- 若 D1 的 `height: auto` 在某主题下产生遮挡投诉，可单独回退为
  `height: max(targetRect.height, 内容高)` 的 JS 方案（已在 D1 记录被否决原因，作为兜底路径）。

## 影响面（blast radius）

| 符号 | 影响 |
|---|---|
| `measureOverlay` | 内部实现重构（抽纯函数），对外行为：list kind 的 left 左移、width 右扩逻辑不变 |
| `InlineEditOverlay` | style 的 height/overflow/contain 三处变化 → 影响所有 block kind（p/h/list/quote/code/table/blank/hr） |
| `buildListWysiwygSeed` | 不变（D5 在 `captureWysiwygInfo` 拦截，不动种子构建） |
| `captureWysiwygInfo` | 新增 collapsed 早退分支 → 只影响折叠列表项 |
| `WysiwygEditor` 根节点 style | `whiteSpace` 变化 → 影响所有 WYSIWYG 块的行内换行表现 |
| `.inline-edit-overlay` / `.wysiwyg-list` CSS | 影响编辑态视觉，不影响阅读态 |

## 验证记录（CDP 实测，2026-11-03）

环境：`npm run dev:cdp`（隔离 profile，CDP 9222）+ Chrome headless（9223）打开组件预览页
`frontend/preview` 的 markdown 预览（新增 editable collapsible 用例）。坐标均为视口像素。

| 场景 | 编辑前文本 (x, y) | 编辑后文本 (x, y) | Δx | Δy | 裁剪 |
|---|---|---|---|---|---|
| 有序列表项（`<li>` 锚点，6 项列表的第 3 项） | (887.5, 666.34) | (887.5, 666.34) | **0** | **0** | 否 |
| 整个 `<ul>` 锚点（条目带嵌套子列表） | (887.5, 510.92) | (887.5, 510.92) | **0** | **0** | 否 |
| 折叠式有序列表项（多行条目） | (935.72, 618.38) | (935.7, 618.38) | **-0.02** | **0** | 否 |
| 普通段落（回归） | (861, 453.94) | (861, 453.94) | **0** | **0** | 否 |

- 编辑器首层 `<ol>` 的 computed `marginLeft / paddingLeft / listStyleType` = `0px / 0px / none` ✔
- `rootWhiteSpace` = `normal`（不再是 `pre-wrap`）✔
- **裁剪动态验证**：打开列表编辑器后向内容追加 8 行 → overlay 高度 21px → 189px，
  `scrollHeight === clientHeight`，无裁剪 ✔
- **旧样式对照**（注入回旧的 `margin-left:1.5em` + li margin + 原生 marker）：Δx = **26.5px**、
  Δy = **5px** —— 与用户报告的"文字位置偏移"一致，说明本测量确实能捕捉该 bug。
- **折叠项回退**：`.collapsed` 条目双击 → 打开的是 textarea（`data-block-kind="list"`，
  存在 `<textarea>`），不是 WYSIWYG ✔（数据安全路径生效）
- **AC7 退出**：Esc 后 overlay 消失、`inline-edit-hidden` / `inline-edit-active` 残留数均为 0，
  块高度与 top 恢复到编辑前（22px / 617.38）✔
- 单测：`markdown-list-wysiwyg.test.tsx` 30 项全绿；`tsc --noEmit` 无新增错误。

> 说明：折叠（`.collapsed`）项在组件预览页无法通过合成点击触发折叠，该路径由
> `captureWysiwygInfo` 单测（3 个用例）+ 上面这次真机"打开的是 textarea"共同覆盖。
