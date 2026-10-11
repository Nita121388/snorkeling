# 车道 4/4：本项目现状 + markdown 可表示性 + 主题 token

**完整交付物（唯一权威版本）**：
`/Users/nita/Primary/obsidians/Obsidian/My Projects/Snorkling/方案/Block-Editor 笔记编辑体验升级/参考-Wolai对标/04-本项目现状与markdown可表示性.md`

## 核心结论（速查）

- **渲染层**：`markdown-render/renderer-registry.tsx` 已是插件化注册表，现注册 22 个 key（a, h1-h6, table, ol, ul, li, img, source, code, pre, waveblock, mermaidblock, input, p, hr, blockquote, calloutalert, span, button）。`shared.ts` 的 `srcLineAttrs()` 是所有块唯一的写盘坐标来源，`domProps()` 剥 `node`。
- **编辑层**：`InlineEditBlockKind` 8 种（p/h/list/quote/table/code/blank/hr）；WYSIWYG 只覆盖 `p/h/list/quote/blank`（`WysiwygBlockKind`）；DOM→md 序列化器只认 `strong/em/del/code/a/img/br` + 块标记，**未知标签一律 unwrap 抹平**（这是往返安全的硬边界）。编辑控制器 9 种意图。
- **块身份**：`data-block-id` = `blk-fnv1a(内容)-出现序号`，纯内容寻址、不写盘；坐标仍是 `data-source-line`。
- **remark 链**：mermaidToTag → fileRefs → softBreaks → gfm → calloutAlert → splitLooseLists → looseListSpacing → blankLineSpacers → blockIds → contentBlock；rehype 链：raw → highlight → sanitize → slug。
- **可表示性（35 类）**：① 原生 11 / ② GFM·Obsidian 约定 12 / ③ HTML 兜底 2（progress·video·audio·iframe 还需加白名单）/ ④ 不可表达 10。
- **最高性价比**：**脚注**（remark-gfm 4.0.1 已原生解析并产出 `<section data-footnotes>`，sanitize 已放行，只缺渲染器与样式）；**数学公式**（`$…$`/`$$…$$`，语法零风险，纯加 `remark-math`+`rehype-katex`）。
- **真 bug 级发现**：① 自研图片尺寸语法 `![alt](path =300x200)` **remark 解析不了**（bare destination 不能含空格）→ 图片实际不渲染；尖括号形式或 Obsidian `![alt|300](path)` 才可行，且该函数零单测。② `--wolai-quote-border-color` / `--wolai-editor-color` 全仓只被引用从未定义 → 引用块/callout 文字恒为近黑色，dark 主题对比度不足。
- **结构性不可表达（必须降级/不做）**：数据表格、同步块、分栏、按钮、提及、面包屑、书签卡片、嵌入第三方（iframe 被 sanitize 剥掉）。
- **测试栈**：vitest 3.0.9 + `// @vitest-environment jsdom` + `renderToStaticMarkup` + 真实 `ReactMarkdown` + 真实 `makeMarkdownSanitizeSchema()`（仓库明确禁止「镜像 schema」）；渲染回归命名 `*.render.test.tsx`。**目前没有任何 markdown.scss 视觉回归测试** —— 本任务要补的空白。
