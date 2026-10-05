# P0: 按块类型拆分 markdown.tsx 渲染器 (registry 化)

## 背景

Snorkeling 的 Markdown 预览/编辑核心单文件 `frontend/app/element/markdown.tsx`（约 6131 行）
承载了渲染 + 行内编辑 + 折叠 + 滚动 + block-editor 集成等全部逻辑。要让它对标思源/我来的
WYSIWYG 体验，必须先解开这个大单体：把「各块类型如何渲染」从主组件中分离出来，形成
「块渲染器 registry」，为后续 P1 编辑内核 / P2 AST 收敛做地基。

## 目标

纯结构性重构：把 markdown.tsx 里的各块渲染组件按块类型抽成独立组件文件，走 registry 化。
**不改变任何编辑/交互逻辑、不改变渲染行为。**

## 范围（要拆出的块组件）

| 块类型 | 符号（均在模块级，仅被 Markdown 内部 components map 引用） |
|---|---|
| 标题 | `CollapsibleHeading` |
| 列表 | `MarkdownOrderedList` / `MarkdownUnorderedList` / `CollapsibleOrderedListItem` / `MarkdownListItem` / `MarkdownTaskCheckbox` |
| 表格 | `CollapsibleTable` |
| Mermaid | `Mermaid` + `initializeMermaid` / `mermaidInstance` |
| 代码块 | `CodeBlock` + `ShellLikeLangs` / `isShellLike` / `CodeBlockCollapseLineThreshold` / inline `Code` |
| 图片 | `MarkdownImg` + `MarkdownSource` |
| 链接 | `Link` + `MarkdownLinkTooltip` / `MarkdownLinkEditor` |
| 内容块 | `WaveBlock` |

## 需要的共享依赖（拆分时移到共同模块）

- 源码坐标辅助：`getSourceLine` / `getSourceLineEnd` / `sourceLineAttrs` / `srcLineAttrs`
- 文本辅助：`getTextContent` / `splitOrderedListItemChildren`（已导出）/ `getOrderedListItemId`
- 上下文：`OrderedListContext`
- Mermaid 单例：`initializeMermaid` / `mermaidInstance`
- 其它已存在的工具：`markdown-util`（图片编辑）、`markdown-transform/code-block`、`image-lightbox`、`ContextMenuModel`

## 验收标准

1. markdown.tsx 拆分后：`Markdown` 符号仍从本文件导出，且行为不变。
2. 对外 API 不变：`computeListInsertAnchor`（被 `markdown-list-insert.test.ts` 引用）仍从 `markdown` 导出。
3. 新增独立组件文件，每个块类型一个（或按内聚度分组）。
4. 新增渲染器 registry（映射块类型 → 渲染器组件），markdown.tsx 的 components map 不再内联各块实现。
5. **行为零变化**：相关测试全程保持绿（重构前跑基线 141 个，重构后同样全绿，diff 无非预期变更）。
6. markdown.tsx 行数显著下降；拆分后跑 `tsc` typecheck 无新增错误。

## 明确不做（本 PR 范围外）

- 不动 `markdown-inline-edit.tsx`（行内编辑内核，P1 再收）
- 不动编辑/交互逻辑、不做行为等价之外的改动
- 不引入 block path（`data-block-path`）——那是后续阶段
- 不重构 remark/渲染管线本身