# P2: 编辑路径收敛到 AST 块模型

## 背景

P0（渲染器 registry 化）+ P1（统一 undo 栈 + 只读块模型 `buildBlockTree`）已完成，地基就绪。

但核心问题（HANDOFF §5 诊断）仍在：**"可编辑状态建立在渲染 DOM 上 = 让视图当了模型"**。
当前编辑提交走 `wysiwyg-editor`（contentEditable）→ `serializeBlockDomToMarkdown`（DOM→Markdown
反序列化）。双向序列化有损、undo/光标/IME 无统一模型、边界 case 爆炸、与 mdast 两套表示不一致。

P2 是**把编辑提交从「DOM 反序列化」切换到「基于块模型的 AST 变换」**，是风险最高的一步。

## 目标架构（HANDOFF §5 对齐）

```
Markdown 原文 ──parse──▶ 块模型(AST) ──render──▶ 渲染 DOM
     ▲                        │
     └──── serialise ─────────┘      （只在保存时做一次）
     编辑操作直接改 AST（纯函数变换）；undo/光标基于 AST 坐标
```

- **渲染**：保留 P0 已 registry 化的 `markdown-render` + ReactMarkdown 管线（成熟、不重造轮子）。
- **编辑**：把"点击即编辑"的提交，从 DOM 反序列化切换为**基于块模型坐标的文本变换**。

## 本任务范围（P2 拆分）

P2 过大且高风险，拆两个可独立验证的交付。**本任务 = P2-A：块模型渲染 + 编辑控制器骨架**。

- **P2-A（本任务）**：
  1. 给 P1 的只读 `buildBlockTree` 补**行内渲染能力**：块模型能把它带坐标的块源码渲染成
     `markdown-render` 组件（作为"语义视图"）。这是编辑收敛时"块模型→所见"的出口。
  2. 建**编辑控制器骨架**（`EditController` / 命名）：统一接收"块坐标 + 意图"→ 调现有
     `markdown-transform` 纯函数 → 产出新文本 → 走 `handleInlineEditCommit`（复用 P1 undo 栈）。
  3. **行为零变化**：控制器/渲染能力为**并行路径，flag 默认关闭**；现有 wysiwyg-editor +
     dom-to-markdown 路径零改动，未启用时零行为差异。
- **P2-B（后续任务，不在本任务）**：逐个块类型（先 prose：p/heading/quote，再列表，最后
  代码/表格）把提交从 DOM 反序列化切换到编辑控制器 + AST 变换，每个块类型一个 PR。

## 验收标准（P2-A）

1. **块模型行内渲染**：`buildBlockTree` 的 Block 能渲染为 markdown-render 组件，坐标/嵌套
   正确；与 ReactMarkdown 渲染同一输入产出等价可见内容（对常见块）。
2. **编辑控制器骨架**：能对给定块坐标执行块级意图（Turn-into / inline style / 列表重编号 /
   checkbox 翻转 / code 语言），产出与现有文本变换等价的新文本，复用 undo 栈。
3. **行为零回归**：既有 490 个 element 测试全绿；新增渲染闭环与控制器单测。
4. **双轨并存**：现有 DOM 路径代码零改动；新路径 flag 默认关闭，未启用零行为差异。
5. **tsc** 无新增错误。

## 明确不做（本任务范围外）

- 不做 P2-B：不关闭任何块类型的 DOM 反序列化、不切换线上编辑路径。
- 不重写 ReactMarkdown 渲染管线（渲染仍走现有 markdown-render）。
- 不做 P3 交互质感（拖拽/悬停工具栏/IME 打磨）。
- 不引入 `data-block-path` 强制迁移。

## 关键取舍点（需用户确认，见 design.md）

- **块模型渲染的定位**：作为"语义视图/编辑出口"（推荐，不替代 ReactMarkdown），还是作为
  生产渲染路径？——推荐前者。
- **编辑控制器入口**：统一"块坐标 + 意图"接口（推荐），还是沿用散落的 markdown.tsx 回调？
- **行内渲染复用**：块文本 → 行内元素用现有 markdown-transform/remark 的能力还是重写？
