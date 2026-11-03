# 执行清单

## 前置

- 包：`snorkeling-docs`（frontend）
- 改动文件：
  - `frontend/app/element/markdown-inline-edit.tsx`
  - `frontend/app/element/wysiwyg-editor.tsx`
  - `frontend/app/element/markdown.scss`
  - `frontend/app/element/markdown-list-wysiwyg.test.tsx`（扩展）

## 步骤

### S1 · 抽出 `resolveOverlayGeometry` 纯函数（行为不变）

- [x] 在 `markdown-inline-edit.tsx` 里把 `measureOverlay` 中 left/width/height 的计算搬进导出纯函数
      `resolveOverlayGeometry(input): OverlayGeometry`（签名见 design.md「契约与类型」）。
- [x] `measureOverlay` 改为：取 rect → 调纯函数 → `setOverlayRect`，保留现有四字段值比较去重。
- [x] 此步**不改变任何输出**（纯重构），先跑一遍现有测试确认零回归。

**验证**：`npx vitest run frontend/app/element/markdown-list-wysiwyg.test.tsx`

### S2 · 列表几何：左扩 marker 区（AC1 水平 / AC5）

- [x] 新增 `resolveListIndentPx(targetEl, blockKind)`：
      - `li` target → 父 `ol/ul` 的 `computed.marginLeft + computed.paddingLeft`
      - `ol/ul` target → 自身的 `computed.marginLeft + computed.paddingLeft`
      - 非 list → 0
- [x] `resolveOverlayGeometry` 里对 `kind === "list"`：`left = targetRect.left - listIndentPx`，
      并把 `left` 钳制到 `renderRect.left`（下限），避免越过内容区左边界。
- [x] 单测：list kind 且 `listIndentPx = 24` → `left` 左移 24；钳制生效时 `left === renderRect.left`。

### S3 · 覆盖层高度语义改为 minHeight + 不裁剪（AC2 / AC3 / AC7）

- [x] `InlineEditOverlay` 的 style：`height` → `minHeight: overlayRect.height`，删除 `height` 定值。
- [x] `overflow: "hidden"` → `overflow: "visible"`；新增 `maxHeight: <视口可用高>px` + `overflow: "auto"`
      作为超高兜底（用 `window.innerHeight - top - 8` 计算）。
- [x] `markdown.scss` 的 `.inline-edit-overlay`：去掉 `contain: layout paint`，保留其余。
- [x] 确认 textarea 的 auto-grow（`scrollHeight`）在 `minHeight` 下仍然生效，且 `draftText` 变短时能缩回。

**验证**：jsdom 无法验证布局，改用 CDP 实测（见 S6）。

### S4 · 列表排版对齐（AC1 垂直 / AC5 / 样式一致）

- [x] `markdown.scss` 新增规则（仅作用于 inline-edit 浮层内的 WYSIWYG 列表根）：

```scss
.inline-edit-overlay[data-block-kind="wysiwyg"] .wysiwyg-list > ul,
.inline-edit-overlay[data-block-kind="wysiwyg"] .wysiwyg-list > ol {
    margin: 0;
    padding: 0;
    list-style: none;
}
.inline-edit-overlay[data-block-kind="wysiwyg"] .wysiwyg-list > ul > li,
.inline-edit-overlay[data-block-kind="wysiwyg"] .wysiwyg-list > ol > li {
    margin: 0;
    padding-left: var(--inline-edit-list-indent, 1.5em);
    text-indent: calc(-1 * var(--inline-edit-list-indent, 1.5em));
}
```

- [x] marker 用伪元素绘制（对齐渲染态 `::before` 的 600 粗细 + `0.286em` 间距）：

```scss
.inline-edit-overlay[data-block-kind="wysiwyg"] .wysiwyg-list > ul > li::before {
    content: "•";
    font-weight: 600;
    margin-right: 0.286em;
    color: var(--secondary-text-color);
}
.inline-edit-overlay[data-block-kind="wysiwyg"] .wysiwyg-list > ol > li::before {
    content: counter(list-item) ".";
    font-weight: 600;
    margin-right: 0.286em;
    color: var(--main-text-color);
}
```

- [x] `--inline-edit-list-indent` 由 `resolveListIndentPx` 的结果写到 overlay style 上（px 值），
      CSS 兜底 `1.5em`。
- [x] 确认嵌套层（`> ul > li > ul`）不被命中，仍保留 `markdown.scss:1034` 的缩进。

### S5 · 移除 WYSIWYG 根的 `pre-wrap` + 折叠项回退（AC4）

- [x] `wysiwyg-editor.tsx:566`：`style={{ ...typography, whiteSpace: "pre-wrap" }}` → `whiteSpace: "normal"`。
- [x] `captureWysiwygInfo`：`blockKind === "list"` 时先检查
      `targetEl.classList.contains("collapsed") || targetEl.querySelector(".collapsed") != null`
      → 命中则 `return null`（回退 textarea）。
- [x] 单测：折叠 li 的 `captureWysiwygInfo` 返回 `null`；非折叠 li 仍返回对象。

### S6 · 回归测试 + 真机校验

- [x] 扩展 `markdown-list-wysiwyg.test.tsx`：
      - `resolveOverlayGeometry` 的 list 左扩 / 钳制 / 非 list 不变
      - 第一层 `ul/ol` 不带 margin 的契约（CSS 无法在 jsdom 断言，改为断言 overlay 上的
        `--inline-edit-list-indent` 值 + 种子根节点结构）
      - 折叠项 `captureWysiwygInfo === null`
- [x] CDP 实测（`node scripts/inspect-electron-ui.mjs`，app 需 `--remote-debugging-port=9222`）：
      1. 打开含 5 项有序列表的 md 预览
      2. 双击第 3 项 → 读 overlay 的 `getBoundingClientRect()`、`scrollHeight` vs `clientHeight`
      3. 读编辑器第一行文字的 rect，与阅读态同一行对比 → AC1 ≤ 1px
      4. 截图留证
- [x] `npx tsc --noEmit` 无新增错误。

## 执行结果（2026-11-03）

全部步骤完成。实测数据与旧样式对照见 `design.md` 末尾「验证记录」：
4 个场景 Δx/Δy ≤ 0.02px、无裁剪；注入旧 CSS 对照重现 Δx=26.5px / Δy=5px。
单测 30 项全绿（`markdown-list-wysiwyg.test.tsx`），相关 5 个测试文件 54 项全绿。

**计划外的两处补充**（都是为了能真机验证，且本身是缺陷修复）：

1. `frontend/preview/vite.config.ts` 加 `resolve.dedupe` —— 组件预览页此前直接崩在
   "Invalid hook call"（vite 预打包拉进了第二份 react），预览页完全不可用。
2. `frontend/preview/previews/markdown.preview.tsx` 的 editable 用例参数化并新增
   collapsible 变体 + 6 项有序列表 —— 折叠式有序列表才是 `.md` 预览的真实形态，原用例覆盖不到。

## 校验命令

```bash
npx vitest run frontend/app/element/markdown-list-wysiwyg.test.tsx
npx vitest run frontend/app/element/markdown-inline-edit.test.ts   # 若存在
npx tsc --noEmit
```

## 评审门禁

- S1（纯重构）与 S2-S5（行为变更）分开提交评审点：S1 必须先零回归，再做后续。
- S3 涉及所有 block kind，需在真机上各点一遍：段落 / 标题 / 列表 / 引用 / 代码块 / 空行。
- S5 的 `whiteSpace` 变更需回归：WYSIWYG 段落里连续空格与软换行的表现。

## 回滚点

| 点 | 回滚方式 |
|---|---|
| S1 | 单独 revert 该提交（纯重构） |
| S2/S4 | 移除 list 左扩 + 新增 CSS 块 |
| S3 | `minHeight` 改回 `height`、`overflow: visible` 改回 `hidden`、恢复 `contain` |
| S5 | 恢复 `pre-wrap`；移除 collapsed 早退 |
