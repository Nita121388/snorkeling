# Directory Structure

> How frontend code is organized in this project.

---

## Overview

<!--
Document your project's frontend directory structure here.

Questions to answer:
- Where do components live?
- How are features/modules organized?
- Where are shared utilities?
- How are assets organized?
-->

(To be filled by the team)

---

## Directory Layout

```
<!-- Replace with your actual structure -->
src/
├── ...
└── ...
```

---

## 目录布局

```
frontend/app/element/
├── markdown.tsx            # Markdown 主组件（渲染 + 行内编辑 + 折叠/滚动/block-editor 集成）
├── use-editor-history.ts   # P1-A 统一 undo/redo 栈（HistoryStack 纯类 + useEditorHistory 薄壳）
├── markdown-render/        # P0 拆分：块渲染器 + registry
│   ├── shared.ts           # 纯函数辅助（源码坐标/文本/OrderedListContext/Mermaid 单例），不 import markdown.tsx
│   ├── heading.tsx         # CollapsibleHeading
│   ├── list.tsx            # MarkdownOrderedList / MarkdownListItem / CollapsibleOrderedListItem / MarkdownTaskCheckbox
│   ├── table.tsx           # CollapsibleTable
│   ├── mermaid.tsx         # Mermaid + inline Code(mermaid 分支)
│   ├── code-block.tsx      # CodeBlock + ShellLikeLangs/isShellLike
│   ├── image.tsx           # MarkdownImg + MarkdownSource
│   ├── link.tsx            # Link + MarkdownLinkTooltip + MarkdownLinkEditor
│   ├── waveblock.tsx       # WaveBlock
│   ├── renderer-registry.tsx  # registerMarkdownRenderer / buildMarkdownComponents + MarkdownRenderContext
│   └── index.ts            # 统一 re-export
└── markdown-transform/     # 纯函数文本变换（源码文本级）
    ├── block-type.ts       # L1 块类型引擎（detectBlockKind/findBlockRangeAtLine/transformBlockType）
    ├── tree.ts             # P1-B M1 只读块模型（buildBlockTree + Block + TreeBlockKind）
    ├── code-block.ts       # 代码围栏识别
    ├── table.ts            # 表格块识别
    └── …
└── block-model/            # P2-A 块模型语义视图 + 编辑控制器（与 markdown-render 分工）
    ├── editor-controller.ts       # BlockEditIntent → markdown-transform 纯函数 → {text,caret}
    ├── editor-controller-instance.ts # 模块级共享单例（P2-B2；index.ts 不转发，避免依赖环）
    ├── render-adapter.tsx   # Block → ReactMarkdown 行内渲染（语义视图，flag 关闭）
    └── index.ts             # 统一 re-export（不含单例）
```

## block-model/ vs markdown-render/ 分工
- `markdown-render/`：ReactMarkdown 的渲染器组件（**生产渲染**走它，P0 已 registry 化）。
- `block-model/`：块模型坐标之上的**语义视图（Block→renderable）** + **编辑控制器（intent→文本变换）**，
  供 P2-B 编辑路径收敛消费。两目录互补不重叠。

## 块渲染器拆分规则（P0 约定）

- **大单体拆块**：把主组件里「各块类型如何渲染」的模块级符号抽到 `markdown-render/`，按块类型一个文件。
- **registry 化**：markdown.tsx 不再内联块渲染器，通过 `buildMarkdownComponents(ctx)` 组装 react-markdown `Components` 映射。
- **对外 API 不变**：markdown.tsx 保留 `Markdown` / `computeListInsertAnchor`，共享符号 `splitOrderedListItemChildren` / `shouldOpenMarkdownLinkInNewBlock` 从 markdown-render 重导出（既有测试从 `./markdown` import）。
- **循环依赖**：shared.ts 是纯函数模块，不得 import markdown.tsx。


---

## Naming Conventions

<!-- File and folder naming rules -->

(To be filled by the team)

---

## Examples

<!-- Link to well-organized modules as examples -->

(To be filled by the team)
