# md 预览列表 inline-edit：几何零位移与内容不裁剪

## Background

### 用户报告

> md 预览时编辑功能问题：列表编辑时文本位置偏移、样式变化，多个列表项还会有部分内容被截断导致显示不全。

三条症状，全部出现在 **md 预览 → 双击列表块进入 inline 编辑** 时：

1. 文字**位置偏移**（水平 + 垂直都跳）
2. 列表**样式变化**（数字/圆点的形态、粗细、间距和阅读态不同）
3. **内容被截断**（列表项多时，尾部看不全）

### 已核实的实现事实

inline 编辑的浮层是 `createPortal` 到 `document.body` 的 `position: fixed` 覆盖层，
几何完全由 `measureOverlay()` 算出（`frontend/app/element/markdown-inline-edit.tsx`）：

| 项 | 现状 | 位置 |
|---|---|---|
| `left` | `targetRect.left`（列表时锚在 `<li>` 左边缘） | `measureOverlay` ~L638-643 |
| `width` | 列表且明显窄时右扩到内容区右边缘 | ~L645-648 |
| `height` | **写死 `targetRect.height`** | ~L654-659 + overlay style ~L1266 |
| 溢出 | **`overflow: hidden`** + `contain: layout paint` | ~L1267 + `markdown.scss:746` |
| auto-grow | **只有 textarea 有**（`scrollHeight`），WYSIWYG 完全没有 | ~L800-822 |

列表种子（`buildListWysiwygSeed`）把 `<li>` 包进 `<ol>/<ul>`，而编辑器 CSS 给这层又加了缩进：

```scss
// markdown.scss:1034-1044
.wysiwyg-editor.wysiwyg-list ul,
.wysiwyg-editor.wysiwyg-list ol {
    margin: 0.357em 0 0.857em 1.5em;
    padding-left: 0.25em;
}
.wysiwyg-editor.wysiwyg-list li {
    padding-left: 0.143em;
    margin: 0.214em 0;
}
```

同时 `WysiwygEditor` 根节点已经吃进了 `typography` 快照（含 `<li>` 的 `paddingLeft`）：

```tsx
// wysiwyg-editor.tsx:566
style={{ ...typography, whiteSpace: "pre-wrap" }}
```

→ **缩进叠了两层**。渲染态 `<li>` 的文本起点是 `li.left + 0.143em`，编辑态变成
`li.left + 0.143em + 1.5em + 0.25em + 0.143em ≈ li.left + 30px`。

竖直方向同理：`<li>` 的 `getBoundingClientRect().height` **不含 margin**，而编辑态内容高度含
`ol` 的 `0.357em` 上边距 + `0.857em` 下边距 + `li` 的 `0.214em × 2` ≈ **+23px** → 超出固定高度 → 被裁。

### 样式变化的独立原因

渲染态的折叠有序列表**不画原生 marker**：

```scss
// markdown.scss:147, 192-198
li.ordered-list-collapsible { list-style-type: none; }
.ordered-list-summary-content::before {
    content: counter(list-item) ".";
    font-weight: 600;
    margin-right: 0.286em;
}
```

而 `buildListWysiwygSeed` 剥掉 chrome 后浏览器画的是原生 `decimal` marker → 数字位置/间距变化。

### 数据安全风险（不能顺手改）

`buildListWysiwygSeed` 会**解包并保留** `.ordered-list-collapse-body` 的子节点。若该 `<li>` 在
阅读态是 `.collapsed`（子内容隐藏），编辑时子内容突然可见 → 高度暴涨（放大症状 3）。
但直接丢弃这些节点会在 commit 时**丢数据**，所以这条必须走"不进入 WYSIWYG"的保守路径。

## Goals

1. 进入/退出列表 inline 编辑时，文字**坐标零位移**（水平、垂直都对齐渲染态）。
2. 编辑态内容**永不被裁剪**：内容比原块高时浮层自动增高，多行段落同样受益。
3. 列表 marker 的形态/粗细/间距与阅读态一致（折叠有序列表的数字不再是原生 marker 跳变）。
4. 折叠（`.collapsed`）列表项**不进入 WYSIWYG**，回退 textarea，杜绝内容丢失。
5. 上述 1-4 有可执行的回归测试锁死。

## Non-Goals

- 不改 md 渲染态（阅读态）的任何样式或 DOM 结构。
- 不重做 WYSIWYG 编辑器的整体架构（只修几何与列表排版）。
- 不处理 table / code block 的浮层几何（它们的 auto-grow 已在各自路径里）。
- 不改 block-editor feature flag 的默认值。

## Acceptance Criteria

- [ ] **AC1** 列表块进入编辑后，编辑器内第一行文字的 `getBoundingClientRect()` 与阅读态同一行文字的
      `top` / `left` 差值 ≤ 1px（CDP 实测）。
- [ ] **AC2** 列表块进入编辑后，编辑器内容 `scrollHeight <= clientHeight`（无裁剪），且列表项数 ≥ 5 时
      最后一项完整可见。
- [ ] **AC3** 多行段落（≥ 5 行）进入编辑后同样 `scrollHeight <= clientHeight`（通用回归，防止只修列表）。
- [ ] **AC4** 折叠（`.collapsed`）的有序列表项双击 → 走 textarea 路径（`captureWysiwygInfo` 返回 `null`），
      提交后源文件内容字节级不变（不丢子项）。
- [ ] **AC5** 编辑器内第一层 `<ul>/<ol>` 的 `computedStyle.marginLeft === "0px"` 且 `paddingLeft === "0px"`。
- [ ] **AC6** `pnpm vitest run frontend/app/element/markdown-list-wysiwyg.test.tsx` 及新增几何单测全绿；
      `tsc --noEmit` 无新增错误。
- [ ] **AC7** 退出编辑（Esc / 失焦）后浮层消失、原块 `inline-edit-hidden` 类被清理，页面回到阅读态且
      无残留高度占位。

## Risks

| 风险 | 说明 | 缓解 |
|---|---|---|
| 浮层增高遮挡下方内容 | `height: auto` 后编辑多行内容会向下盖住后续块 | 属浮动编辑器常规行为；`maxHeight` 限制在视口内 + 内部滚动 |
| 去掉 `contain: layout paint` 影响性能 | 该属性原本用于隔离重绘 | 浮层生命周期短（仅编辑期），可接受；保留 `contain: layout` 视验证结果 |
| 列表左扩导致浮层超出内容区左边 | `left` 减去 marker 宽度后可能越过 `renderRoot.left` | `left` 下限钳制到 `renderRoot.left` |
| 折叠项回退 textarea 后体验不一致 | 折叠项编辑态是源码文本而非 WYSIWYG | 与现有非 WYSIWYG 路径一致，且是数据安全优先的取舍 |
