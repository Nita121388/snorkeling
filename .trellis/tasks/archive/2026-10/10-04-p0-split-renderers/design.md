# P0 Design: 块渲染器拆分 + registry 化

## 目标文件布局

新建目录 `frontend/app/element/markdown-render/`，把 markdown.tsx 模块级(167-1784 行)的块渲染组件按块类型抽出，配一个渲染器 registry。markdown.tsx 保留主组件 `Markdown`、滚动/折叠/编辑内核逻辑，通过 registry 获取各块渲染器。

```
frontend/app/element/markdown-render/
├── shared.ts        # 共享辅助：getSourceLine/getSourceLineEnd/sourceLineAttrs/srcLineAttrs/
│                    # getTextContent/OrderedListContext/splitOrderedListItemChildren/
│                    # getOrderedListItemId/mermaid 单例
├── heading.tsx      # CollapsibleHeading + HeadingProps
├── list.tsx         # MarkdownOrderedList/MarkdownUnorderedList/CollapsibleOrderedListItem/
│                    # MarkdownListItem/MarkdownTaskCheckbox + 列表辅助
├── table.tsx        # CollapsibleTable
├── mermaid.tsx      # Mermaid + initializeMermaid/mermaidInstance + inline Code(mermaid 分支)
├── code-block.tsx   # CodeBlock + ShellLikeLangs/isShellLike/CodeBlockCollapseLineThreshold
├── image.tsx        # MarkdownImg + MarkdownSource
├── link.tsx         # Link + MarkdownLinkTooltip + MarkdownLinkEditor + shouldOpenMarkdownLinkInNewBlock
├── waveblock.tsx    # WaveBlock + WaveBlockProps
├── registry.ts      # 块渲染器 registry（块类型 → 渲染器组件）+ MarkdownRenderContext 类型
└── index.ts         # 统一 re-export
```

## 关键决策

### 1. 共享上下文类型 `MarkdownRenderContext`
各块渲染器需要来自主组件的上下文（resolveOpts、onInlineEditCommit、折叠状态、handler 等）。
定义统一的 context 类型，registry 负责把"块渲染器 + context"组装成 react-markdown 的 `Components` 条目。

```ts
export interface MarkdownRenderContext {
  text: string;
  resolveOpts?: MarkdownResolveOpts;
  onInlineEditCommit?: (newFullText: string) => void;
  onClickExecute?: (cmd: string) => void;
  focusHeading: (href: string) => void;
  collapsedHeadings: Set<string>;
  toggleHeadingCollapse: (id: string) => void;
  collapsedTables: Set<string>;
  toggleTableCollapse: (key: string) => void;
  collapsibleOrderedLists: boolean;
  collapsedOrderedListItems: Set<string>;
  toggleOrderedListItemCollapse: (id: string) => void;
  handleTaskCheckboxToggle: () => void;
  handleLinkHoverIn?: (el: HTMLAnchorElement, offsets?: { start?: number; end?: number }) => void;
  handleLinkHoverOut?: () => void;
  contentBlocksMap: Map<string, MarkdownContentBlockType>;
  waveBlockRenderers?: Record<string, (block: MarkdownContentBlockType) => React.ReactNode>;
}
```

### 2. registry 形状（与 block-editor/registry.ts 同构）
```ts
export interface MarkdownRendererSpec {
  /** react-markdown 元素 key（h1/h2/p/li/table/pre/img/a/ol/ul/...） */
  key: string;
  /** 把 element props + context 转成渲染结果 */
  render: (props: any, ctx: MarkdownRenderContext) => React.ReactNode;
}
const renderers = new Map<string, MarkdownRendererSpec>();
export function registerMarkdownRenderer(key, spec): () => void;
export function getMarkdownRenderer(key): MarkdownRendererSpec | undefined;
export function listMarkdownRenderers(): MarkdownRendererSpec[];
/** 组装 react-markdown components 映射（含 waveblock/mermaidblock/input 条件分支） */
export function buildMarkdownComponents(ctx: MarkdownRenderContext): Partial<Components>;
```

### 3. 对外 API 保持不变
- markdown.tsx 仍导出 `Markdown`、`computeListInsertAnchor`。
- `splitOrderedListItemChildren`、`shouldOpenMarkdownLinkInNewBlock` 移到 shared/link 后，从 markdown.tsx **re-export**（测试 `import ... from "./markdown"`）。

### 4. 行为零变化
- 拆分纯搬移：每个块组件函数体/JSX 原样保留，仅把外部依赖改为从 shared.ts import。
- 主组件 `Markdown` 内部的 `markdownComponents` useMemo 改为调用 `buildMarkdownComponents(ctx)`，依赖数组保留原引用以维持 memo 命中语义（selection/collapse 状态不丢）。
- waveblock/mermaidblock/input 的条件分支在 registry 内实现。

## 兼容与风险
- 风险 LOW：仅重构 markdown.tsx 内部模块级符号；外部 3 个文件只依赖 `Markdown` 与 `computeListInsertAnchor`（保留）。
- circular import：shared.ts 是纯函数模块，不 import markdown.tsx，避免环。
- Mermaid 的 `initializeMermaid`/`mermaidInstance` 是模块单例，放入 shared.ts（被 CodeBlock/Mermaid 共享）。

## 不做
- 不改 markdown-inline-edit.tsx、不改行为、不加 data-block-path、不改 remark 管线。