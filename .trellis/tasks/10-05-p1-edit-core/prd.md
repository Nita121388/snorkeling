# P1: 新建编辑内核（AST 变换 + 统一 undo 栈 + 双轨灰度）

## 背景

P0 已完成：`markdown.tsx`（6131→4575 行）按块类型拆分成 `markdown-render/` 渲染器 registry，
对外 API 不变，测试全绿。这建立了"渲染器可单独演进"的基础。

但核心诊断（HANDOFF §5）仍在：**"可编辑状态建立在渲染 DOM 上 = 让视图当了模型"**，
双向序列化有损、undo/光标/IME 无统一模型、边界 case 爆炸、与 mdast 两套表示不一致。
这是体验差的根治原因。

P1 是**收益最大、成败所在**的一步（HANDOFF §6 警告：别跳过它直接做交互）。

## 现状（已勘察，别再重查）

| 事实 | 位置 |
|---|---|
| 所有编辑（行内/checkbox/表格/列表重编号/code 语言）汇聚到单一提交通道 `handleInlineEditCommit(newText)` | markdown.tsx |
| 提交落盘：`globalStore.set(model.newFileContent, newText)` → draft atom，dirty 标记 + Cmd+S 落盘 | preview-markdown.tsx / preview-model.tsx |
| 现有 undo 只有 `handleFileRevert`（整体回退磁盘版），**无逐操作 undo/redo 栈** | preview-model.tsx |
| `markdown-transform/` 已是纯函数 L1 块类型引擎（源码文本级，不做全文档重序列化），含 block-type/code-block/table/inline-style/triggers/doc-meta/emoji | markdown-transform/ |
| remark 已有 mdast 渲染管线（remark-gfm + 自定义 plugin），`Root from mdast` 可用 | remark/ |
| 无真正"AST 块模型"：无 mdast 之上的稳定坐标块模型 | — |

## 目标

把"单一提交通道"升级为**编辑内核**：

1. **统一 undo/redo 栈**：在 `handleInlineEditCommit` 漏斗上挂一个基于文本快照 + 块坐标的
   undo/redo 栈，让**每一类编辑**（不止行内）都可撤销/重做。这是本 P1 的**核心交付**。
2. **AST 块模型层（M1 MVP）**：定义 `Block` 类型系统（基于 mdast），给每个块稳定坐标
   （源码行范围），打通 `Markdown 原文 → parse → 块模型 → renderer` 最小闭环。
3. **双轨并存灰度**：DOM 反序列化路径（`dom-to-markdown` / `wysiwyg-editor`）**暂留不动**，
   AST 路径并行建立，不强制切换。

## 验收标准

1. **统一 undo/redo 可用**：行内编辑、task checkbox、表格 cell、code 语言、列表重编号
   这几类编辑都能 `Cmd/Ctrl+Z` 撤销、`Cmd/Ctrl+Shift+Z`（或 Cmd+Y）重做；undo 后
   draft atom / 渲染 / 光标一致，无丢失。
2. **undo 栈正确性**：连续 N 次编辑可逐步撤销 N 步，重做 N 步；撤销后再次编辑会
   清空 redo 分支；跨保存（Cmd+S）不破坏 undo 栈语义。
3. **AST 块模型 MVP**：`parse → Block[]` 能对常见块（标题/段落/列表/引用/代码/表格/
   图片/链接/分隔线）产出带稳定行坐标的块；`Block[] → renderer` 最小闭环能渲染。
4. **行为零回归**：既有 469 个 element 测试全绿；新增 undo/redo 与块模型单测。
5. **双轨不破坏**：DOM 路径（wysiwyg-editor / dom-to-markdown / markdown-inline-edit）
   逻辑不动，AST 路径为可选的并行层，未切换时零行为差异。
6. **tsc** 无新增错误。

## 明确不做（本 PR 范围外）

- 不做 P2 的"编辑路径收敛"（逐个块类型关闭 DOM 反序列化）——P1 只建内核与 undo 栈。
- 不做 P3 交互质感（拖拽/悬停工具栏/IME 打磨）。
- 不引入 `data-block-path` 强制迁移；双轨并存。
- 不改 remark/渲染管线本身（AST 块模型是并行的"语义视图"，渲染仍走现有 markdown-render）。

## 关键取舍点（需用户确认，见 design.md）

- **undo 栈粒度**：按"单次提交通道调用"记录（推荐）还是按"块内字符级"记录？
- **undo 栈宿主**：挂 preview-model 层（跨 Markdown 实例/含 Monaco）还是 markdown.tsx 层？
- **AST 块模型范围**：M1 只做"只读块模型 + 坐标"（推荐），编辑操作仍走文本变换，还是直接
  让编辑改 AST？
- **双轨灰度策略**：AST 路径默认关闭、仅测试/开关启用（推荐）？
