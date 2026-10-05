# P2-A Design: 块模型渲染 + 编辑控制器骨架

## 现状边界（影响设计的关键事实）

- **P1 已交付**：`buildBlockTree`（只读块模型，Block[] 带行坐标/嵌套）+ 统一 undo 栈
  （`useEditorHistory`，挂 `handleInlineEditCommit`）。
- **渲染现走 ReactMarkdown**（remark→mdast→`markdown-render` 组件），成熟、registry 化。
- **编辑现走 wysiwyg-editor（contentEditable）→ dom-to-markdown 反序列化**，这是 P2 要收敛的路径。
- **意图→文本变换已有雏形**：`block-editor/exec.ts` 的 `execSlashCommand` + `transformBlockType`/
  `setCodeBlockLanguage`/`toggleTaskCheckboxAtLine`/`applyInlineStyle` 等纯函数，都是
  "源码文本 → 源码文本"，单次 commit 一步。

## 关键决策

### 决策 1：块模型渲染 = "语义视图/编辑出口"，不替代 ReactMarkdown（推荐）

**问题**：块模型渲染是作为生产渲染路径，还是作为编辑收敛时的"块模型→所见"出口？

**推荐**：**后者**。理由：
- ReactMarkdown + remark 管线已完美处理行内/表格/GFM 等，重写渲染器会重复造轮子且退化风险高。
- P2 的核心是**编辑收敛**（把"改哪"从 DOM 改到块模型坐标），渲染保持现状。
- 块模型渲染作为**并行能力**，供：(a) 单测验证块模型坐标正确；(b) P2-B 编辑时把
  "编辑意图后的块内容"渲染成所见，作为 commit 前的反馈面。
- flag 默认关闭，未启用零行为差异。

**接口**：`Block → ReactNode` 的纯函数适配，输入块源码文本，复用 remark 的行内渲染能力。

### 决策 2：编辑控制器 = "块坐标 + 意图 → 文本变换 → commit"（推荐）

**问题**：编辑操作分散在 markdown.tsx 各种回调，还是统一到一个控制器？

**推荐**：**统一控制器**，与 exec.ts 的 "single commit" 哲学一致：
```ts
// frontend/app/element/block-model/editor-controller.ts（命名可调）
export interface BlockEditIntent {
    block: Block;                 // 块模型坐标（startLine/endLine/kind）
    op:
        | { type: "turn-into"; to: BlockKind }
        | { type: "inline-style"; style: InlineStyleId }
        | { type: "toggle-task" }
        | { type: "set-code-lang"; lang: string | null }
        | { type: "renumber-list"; fromLine: number };
}
export interface EditController {
    apply(intent: BlockEditIntent, ctx: { text: string }): { text: string; caret?: number } | null;
}
```
- 内部把 intent 映射到现有 `markdown-transform` 纯函数（transformBlockType / applyInlineStyle /
  toggleTaskCheckboxAtLine / setCodeBlockLanguage）。
- 产出新文本后，由调用方走 `handleInlineEditCommit`（复用 P1 undo 栈）。
- 纯函数 + 薄壳，可单测；P2-B 再把具体编辑器接入。

### 决策 3：行内渲染复用 remark，不重写（推荐）

**问题**：块源码文本 → 行内元素，怎么渲染？

**推荐**：复用现有能力。最小实现：`BlockRenderAdapter` 用 `unified` + remark-parse + 现有
行内插件（soft-breaks 等）把块文本转 mdast，再喂给 markdown-render 的行内组件。或者更轻：
对 M1 只做纯文本 + 行内样式（bold/italic/code/link）的渲染，走 remark 的最小管线。
具体在实现时验证最省力的复用点。

## 目录与文件

```
frontend/app/element/block-model/        # P2-A 新目录
├── index.ts              # 统一 re-export
├── render-adapter.tsx    # Block → ReactNode（块模型行内渲染，flag 关闭）
├── editor-controller.ts  # 编辑控制器：BlockEditIntent → 文本变换 → {text, caret}
├── editor-controller.test.ts
└── render-adapter.test.tsx
```

（`block-model/` 与 `markdown-render/` 分工：后者是 ReactMarkdown 的渲染器组件；前者是
块模型自身的语义视图/编辑控制器。）

## 兼容与风险

- 风险 HIGH（P2 整体）。本任务 P2-A 已用**并行 + flag 关闭**降险：
  1. 渲染适配器默认不接入生产渲染，仅测试/开发用。
  2. 编辑控制器为纯函数层，不改变现有编辑入口；现有 wysiwyg-editor/dom-to-markdown 零改动。
  3. 复用已有 transform 纯函数，不改它们的签名/行为。
- 负向：P2-B 逐块类型切换仍高风险，但那是后续任务。

## 不做

- 不做 P2-B（不关闭 DOM 反序列化、不切换线上编辑路径）。
- 不改 ReactMarkdown 渲染、不改 markdown-transform 现有纯函数。
- 不做 P3 交互质感。
