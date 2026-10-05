# P2-A Implement Plan

## 状态：实施完成 ✓（2026-10-05）

## 已交付
- **P2-A1 编辑控制器**：`frontend/app/element/block-model/editor-controller.ts`（createEditController +
  lineRangeToCharOffset + BlockEditIntent）。复用 markdown-transform 纯函数（transformBlockType /
  applyInlineStyle / toggleTaskCheckboxAtLine / setCodeBlockLanguage / renumberOrderedListBlockAtLine），
  不改签名/行为。10 个单测。
- **P2-A2 块模型渲染适配器**：`frontend/app/element/block-model/render-adapter.tsx`（BlockModelRenderer /
  BlockTreeRenderer），行内渲染复用 ReactMarkdown + remark-gfm。8 个单测（renderToStaticMarkup）。
- **index.ts** 统一 re-export。
- 验证：element 39 文件 / 508 测试全绿（490 基线 + 18 新）；tsc 新文件零错误（仅预存在
  markdown.tsx(442) loadable 报错）。双轨并存：现有 DOM 路径零改动。

## P2-B 前瞻风险（trellis-check 审查记录，开工 P2-B 前必读）
- **R1 列表项 turn-into 作用域塌缩**：块坐标是逐列表项，但 transformBlockType 作用于整组。
  对组内某项 turn-into→heading 会整组合并（`- a\n- b`→heading 变 `# a\nb`）。P2-B 需
  组级定位或专门处理，否则误伤整组。
- **R2 扁平列表渲染多 `<ul>`**：每个顶层块独立 ReactMarkdown → 兄弟列表项渲染成多个独立
  `<ul>`。语义视图骨架可接受；P2-B 编辑预览应优先用生产渲染器。
- **R3 inline-style 偏移口径**：intent.start/end 是相对 block.text 源码的 0-based 偏移（含
  列表标记/标题 `#` 前缀），不是渲染后可见内容偏移。已写入 BlockEditIntent jsdoc。

---

## 阶段划分

P2-A 拆两个子交付，各自独立可验证：

- **P2-A1 编辑控制器（纯函数层）**：`BlockEditIntent → 文本变换 → {text, caret}`，复用
  现有 markdown-transform 纯函数 + 块模型坐标。
- **P2-A2 块模型渲染适配器**：`Block → ReactNode` 的语义视图（行内渲染，flag 关闭）。

先做 A1（控制器，纯逻辑最好测），再做 A2（渲染，需复用 remark 行内能力）。

---

## P2-A1：编辑控制器

### Step 1 新建 `frontend/app/element/block-model/editor-controller.ts`
- 定义 `BlockEditIntent`（turn-into / inline-style / toggle-task / set-code-lang / renumber-list）
  与 `EditController.apply(intent, {text})`。
- 复用纯函数：`transformBlockType`、`applyInlineStyle`（需先算字符偏移，从 Block.startLine →
  `lineStartOffset` 换算 + 选定区间）、`toggleTaskCheckboxAtLine`、`setCodeBlockLanguage`、
  `renumberOrderedListBlockAtLine`。
- 产出 `{ text, caret? }`；不改这些纯函数签名/行为。
- 纯函数薄壳，无 DOM/React 依赖。

### Step 2 测试
- `editor-controller.test.ts`：每个 op 类型一例（turn-into 块、inline-style 加粗/斜体、checkbox
  翻转、code 语言、列表重编号），断言新文本与 caret。

### 验收
- 控制器对常见块意图产出与现有文本变换等价的新文本。

---

## P2-A2：块模型渲染适配器

### Step 1 新建 `frontend/app/element/block-model/render-adapter.tsx`
- 把 `buildBlockTree` 的 `Block` 渲染为 `markdown-render` 组件（heading/list/code/table/quote 等）。
- 行内渲染复用 remark（unified + remark-parse + 现有 soft-breaks 等）把块文本转 mdast 行内，
  或 M1 最小实现（纯文本 + 行内样式）。
- 对外一个 `renderBlockTree(blocks: Block[], ctx): ReactNode[]`，纯函数（可 renderToStaticMarkup 测）。
- 默认不接入生产渲染（flag/仅测试）。

### Step 2 测试
- `render-adapter.test.tsx`：`renderToStaticMarkup` 验证标题/列表/代码/表格块产出预期 HTML。

### 验收
- 块模型渲染对常见块产出与输入一致的可见内容；坐标/嵌套正确。

---

## 校验门
- [ ] P2-A1：editor-controller 单测全绿
- [ ] P2-A2：render-adapter 单测全绿
- [ ] 既有 490 element 测试全绿（双轨：现有 DOM 路径零改动）
- [ ] tsc 无新增错误
- [ ] 新路径 flag 默认关闭，未启用零行为差异

## 提交
- P2-A1、P2-A2 各一个 commit（或视体积合并），每次前 `pwd && git branch --show-current`。
- 关联 task 10-05-p2-ast-converge。