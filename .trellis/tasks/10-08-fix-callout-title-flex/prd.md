# fix: callout/blockquote title flex 布局导致中文竖排多栏

## 问题

引用块/callout 的第一行渲染为 `.markdown-alert-title`，CSS 设了 `display: flex`
（`frontend/app/element/markdown.scss:301`）。remark 插件
（`frontend/app/element/remark/callout-alert.ts:61-66`）把 emoji 按钮和第一行**所有 inline
子节点**平铺进 title：`children: [button, ...titleChildren]`。

于是第一行里的每个行内元素（`<strong>` / `<em>` / `<a>`）都成了**独立 flex item**：
- flex item 宽度塌缩到内容最小宽度 → 中文在极窄容器里逐字换行 = **竖排**
- 多个 item 横排 = 用户看到的**分栏**

CDP 实测：title `display: flex, itemCount = 5`，其中 `STRONG w=18 h=101`（一个字宽、六行高）。

**影响面**：所有 `>` 引用块（插件把所有 blockquote 都转成 `.markdown-alert`），只要**第一行**有
≥1 个行内元素就会触发（emoji 按钮已占一个 flex item）。

## 方案（用户选定 A：结构修复）

1. `callout-alert.ts`：把非按钮的 inline children 包进 `<span class="markdown-alert-title-text">`
   → flex 只剩 2 个 item（按钮 + 文本容器），文本容器内正常文本流换行。
2. `markdown.scss`：加 `.markdown-alert-title-text { flex: 1 1 auto; min-width: 0; }`
   （`min-width: 0` 允许文本容器在窄父容器下收缩，避免溢出）。
3. 新增 `callout-alert.test.ts`：断言 title 的 children 结构为 `[button, span]`（方案 A 契约）。

## 验收标准

- [ ] title children = `[button, span.markdown-alert-title-text]`，span 内含原 inline children
- [ ] 空 title（第一行只有 `[!note]` marker）时 span 为空、不产生多余可见内容
- [ ] emoji 按钮仍是独立 flex item（hover 交互不变）
- [ ] 新增单测覆盖上述结构契约
- [ ] 既有 572 element 测试全绿；tsc 无新增错误

## 风险

低。改动局限在 callout title 渲染：blockquote 第一行的 emoji 按钮位置/hover 交互不变，
仅文本部分的 flex 行为从「多 item」变为「单容器」。正文（第二行起）不受影响。

## 明确不做

- 不改 callout 的解析语义（哪一行算 title、emoji 提取逻辑）
- 不改正文段落（第二行起）的渲染
- 不做视觉设计调整（配色/间距/字号）