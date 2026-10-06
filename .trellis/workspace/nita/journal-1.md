# Journal - nita (Part 1)

> AI development session journal
> Started: 2026-10-03

---

## 2026-10-04 — P0: 按块类型拆分 markdown.tsx 渲染器 (registry 化)

- Task: `.trellis/tasks/10-04-p0-split-renderers` (in_progress)
- 完成时间：2026-10-05

### 做了什么
- 把 6131 行 `frontend/app/element/markdown.tsx` 的块渲染器按块类型抽成独立组件文件，
  目录 `frontend/app/element/markdown-render/`（11 个文件）。
- 建立渲染器 registry：`renderer-registry.tsx`（registerMarkdownRenderer / buildMarkdownComponents）。
- `markdownComponents` useMemo 改为调用 `buildMarkdownComponents(ctx)`，依赖数组逐项保留（memo 语义不变）。
- 对外 API 不变：Markdown / computeListInsertAnchor / 重导出 splitOrderedListItemChildren、shouldOpenMarkdownLinkInNewBlock。
- markdown.tsx 从 6131 行降到 ~4574 行（-1589）。

### 验证
- 35 个 element 测试文件 / 469 测试全绿（等于基线）。
- tsc 对比 HEAD 无新增错误（line-430 loadable 报错为预存在）。
- trellis-check 发现并修复 1 处行为回归：img/pre 提交应走 handleInlineEditCommit 包装器
  （含列表重编号+自动落盘），registry 新增 commitFullText 字段承载。

### 关键设计
- 共享辅助放 `shared.ts`（纯函数，不 import markdown.tsx，避免循环）。
- registry 用 MarkdownRenderContext 传 host 回调，使 memo 语义不变。

## 2026-10-05 — P1: 编辑内核（统一 undo 栈 + AST 块模型 MVP）

- Task: `.trellis/tasks/10-05-p1-edit-core`（已 archive）

### 做了什么
- **P1-A 统一 undo/redo 栈**：新建 `use-editor-history.ts`（HistoryStack 纯类 + useEditorHistory 薄壳）。
  接入 markdown.tsx 的 handleInlineEditCommit 收敛点（所有编辑都过这一个漏斗）。
  keydown 加 Cmd+Z / Cmd+Shift+Z / Cmd+Y。normalize 走 skipHistory 不入栈。
- **P1-B AST 块模型 MVP**：新建 `markdown-transform/tree.ts`（buildBlockTree + Block + 稳定 id）。
  复用 block-type 的 findBlockRangeAtLine，内置 hr 识别。

### trellis-check 发现并修复
1. undo 链 bug：lastAppliedTextRef 未在 undo 回填路径更新 → 「撤销后再次编辑」before 取过期文本。
2. hr 缺口：block-type 无 hr，`***` 会被当 text 跨行并入段。tree.ts 内置 HrLineRe+clipAtHr 修复。

### 验证
- element 37 文件 / 490 测试全绿（469 基线 + 21 新）；tsc 新文件零错误。

### 关键设计
- undo 基准挂在「单一提交通道」（handleInlineCommit），不分散到各编辑器。
- undo 粒度 = 单次 commit 一步（块级，对标思源/我来）。
- undo/redo 走 applyText 独立通道（不 arm autosave，可整体 Revert），与 draft/saved 双态正交。

## 2026-10-05 — P2-A: 编辑控制器 + 块模型渲染适配器

- Task: `.trellis/tasks/10-05-p2-ast-converge`（已 archive）

### 做了什么
- 新建 `frontend/app/element/block-model/`：
  - `editor-controller.ts`：createEditController + BlockEditIntent + lineRangeToCharOffset。
    intent（turn-into/inline-style/toggle-task/set-code-lang/renumber-list）→ 现有 markdown-transform
    纯函数 → {text,caret}。纯函数薄壳，无 DOM/React。
  - `render-adapter.tsx`：Block → ReactMarkdown 行内渲染（语义视图，flag 关闭）。
- 双轨并存：现有 wysiwyg-editor/dom-to-markdown 路径零改动，行为零回归。

### trellis-check 审查
- 通过，无缺陷。记录 P2-B 前瞻风险 3 条：
  - R1 列表项 turn-into 作用域塌缩（坐标逐项 vs 变换整组）。
  - R2 扁平列表渲染多 <ul>（语义视图骨架，P2-B 用生产渲染器）。
  - R3 inline-style 偏移口径（相对 block.text 源码含 markers）——已写入 BlockEditIntent jsdoc。

### 验证
- element 39 文件 / 508 测试全绿（490 基线 + 18 新）；tsc 新文件零错误。

### 关键设计
- block-model/ 与 markdown-render/ 分工：前者是块模型的语义视图/编辑控制器（P2-B 消费），
  后者是生产渲染器组件。

## 2026-10-05 — P2-B1: 编辑提交收敛最小闭环（code 语言）

- Task: `.trellis/tasks/10-05-p2-b-converge-edits`（已 archive）

### 做了什么
- markdown.tsx 的 onApplyLanguage 改为走 P2-A 编辑控制器（set-code-lang intent）。
- 打通「真实编辑 → 控制器 → 文本变换 → undo 栈」最小闭环，作为 prose/list 收敛模板。
- 模块级单例 editorController = createEditController()。

### 关键点
- based 语义核实：session.startLine 1-based → Block.startLine-1 0-based → 控制器 +1 还原
  1-based → setCodeBlockLanguage idx = startLine-1，与现状等价无 off-by-one。
- 新增非首行代码块换算测试锁定该转换。

### 验证
- element 39 文件 / 509 测试全绿（508 基线 + 1 新增）；tsc 无新增错误。
---

## 2026-10-05 P2-B2：prose 块（p/h/quote/blank）提交收敛到块模型控制器

### 交付
- `BlockEditIntent` 新增 `replace-content`（整体替换块内容，非确定性变换，独立 intent）。
- 控制器分支用 `lineRangeToCharOffset(block.startLine, block.endLine)` 定位绝对偏移做 slice 替换，
  返回 `{text, caret}`；LF 文件与 replaceSourceRange 严格等价（wave 保存一律 \n）。
- 单例下沉：新建 `block-model/editor-controller-instance.ts`（模块级共享，index.ts 不转发避免依赖环），
  markdown.tsx（code 语言）与 markdown-inline-edit（prose 提交）共用同一实例。
- `markdown-inline-edit.tsx` commit() 新增 wysiwyg-prose 分支：`current.wysiwyg && committedDraft.length > 0
  && p/h/quote/blank` → 构造 0-based Block（`inlineKindToTreeKind` 映射 kind：h 从 `#` 前缀推断级别、
  quote→quote、p/blank→text）→ apply replace-content → onCommit → handleInlineEditCommit（P1 undo 栈）；
  res==null 兜底 fallthrough 原 replaceSourceRange；textarea/list/table/code 零改动。
- 空内容契约：控制器空 content 留块尾空行（字符替换语义），与 replaceSourceRange 删整行不同；
  guard `committedDraft.length > 0` 保证空内容回落原路径（清空段落=删行，与现状严格等价）。
- CRLF 已知差异：按 \n 切坐标，\r 归属块行，边界 EOL 不重写；非生产场景，测试/注释注明。

### 验证
- element 39 文件 / 517 测试全绿（509 基线 + 8 个 replace-content 用例）；tsc 零新增（68 基线不变）。
- trellis-check 复验：阻断项（空内容差异）已修复，验收标准 1-5 全部 PASS。
## 2026-10-06 P2-B3：列表块（bulleted/numbered/todo）提交收敛到块模型控制器

### 勘察发现（关键）
- 现状 WYSIWYG list 提交存在**重复 marker bug**：DOM 序列化产物（serializeListDomToMarkdown）
  已含每行 marker，但 commit else 分支又 wrapListMarker 包一层 → `- - apple`（vitest jsdom 实测）。
  textarea 路径（手输无 marker）的 wrapListMarker 是对的，只有 WYSIWYG list 路径错了。
- 列表会话作用域：resolveEditTargetFromEl 对普通 li 是单项，含嵌套子列表提升到整组 ul/ol。

### 交付
- 复用 P2-B2 的 replace-content intent（不新增 intent）：commit() wysiwyg 分支条件加入 "list"，
  整体替换 committedDraft（已含 marker）→ 修复重复 marker bug；共享单例不变。
- inlineKindToTreeKind 增加 list 分支：todo/numbered/bulleted 推断（todo 正则锚定 marker 位置，
  与 ListItemLineRe 语义一致，防正文 [x] 误判）。
- else 分支 wrapListMarker 保留（只服务 textarea 路径）；空内容 guard 与 P2-B2 一致（回落删行）。
- 测试 +9：单项/整组/有序/任务/嵌套/空内容/textarea 回归/中段块/todo 边界正则。

### 验证
- element 39 文件 / 526 测试全绿（517 基线 + 9）；tsc 68 基线不变零新增。
- trellis-check 复验：6 条验收标准全部 PASS；非阻塞建议（正则锚定）已落实并补边界测试。

### 待处理
- R1（turn-into 组级塌缩）不在 blur 提交路径内，P2-B 后续如需处理另开任务。
- R2/R3 仍待后续阶段。
