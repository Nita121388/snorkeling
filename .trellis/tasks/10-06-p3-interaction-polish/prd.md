# P3: 交互质感打磨（对标思源 Siyuan / 我来 Wolai）

## 背景

P0（渲染 registry）、P1（统一 undo 栈）、P2-A（编辑控制器 + 渲染适配器）、P2-B1/B2/B3
（code/prose/list 提交收敛到块模型控制器，B3 同时修复 WYSIWYG list 重复 marker bug）已完成。
编辑路径已全部收敛到「块坐标 + intent + 控制器 + undo 栈」模式，39 文件 / 526 测试全绿。

P3 是 HANDOFF.md 交接文档的**最后一个阶段**：交互质感。目标是让编辑体验对标思源/我来的
「块编辑器」水准——悬停即见操作、拖拽即重排、键盘流畅导航、中文 IME 不抖动。

**现状盘点（已勘察，别再重查）：**

| 交互 | 现状 | 位置 |
|---|---|---|
| 块悬停 grip（四圆点）+ 块菜单 | 已有：hover 显示、点击选中 + popup（copy/duplicate/delete 等） | markdown.tsx「Block grip / insert / drag-reorder / selection」（1247） |
| 块边缘插入按钮（A/B 行） | 已有：hover 显示插入锚点，点击 insert | 同上（1340） |
| 块拖拽重排 | 已有：grip 为手柄 HTML5 DnD，支持多选范围拖拽 | markdown.tsx（2144） |
| 块选择（单选 + 多选） | 已有：grip 点击单选高亮；Ctrl/Cmd+拖拽多选 | markdown.tsx（1426/1450） |
| 浮空工具栏（选中文字） | 已有：FloatingToolbar（M2） | block-editor/components/floating-toolbar.tsx |
| slash 面板 + 打字触发 | 已有（M2） | markdown.tsx（2556） |
| emoji 选择器 | 已有（M3） | markdown.tsx（3006） |
| 表格工具栏 | 已有（M4） | block-editor/components/table-toolbar.tsx |
| Enter 分块 / ArrowUp/Down / 退格合并 | 已有 | markdown.tsx（1724/1819/1872） |
| 链接悬停编辑 | 已有（feature ⑥） | markdown.tsx（875/974） |
| 图片粘贴 → assets | 已有 | markdown.tsx（1897） |
| **IME 合成（中文输入法）** | **缺失**：无 composition 事件处理；输入法组合期间可能误触发打字触发/提交/换行 | 全链路 |

## 本任务范围（P3）

以**产品评审差距分析为输入**的交互质感打磨。先派产品评审子代理 + 资深开发子代理对照
思源/我来评估现有交互完成度与缺陷，产出差距清单；再按差距清单逐项实施（每个独立项一个
PR/commit，可回滚）。

**已知的明确缺口（勘察确认）：**
1. **IME 合成处理缺失**：中文/日文输入法 composition 期间，打字触发（detectTypingTrigger）、
   回车分块、blur 提交可能误触发。需要 compositionstart/compositionend 标记，合成期间
   禁用 typing-trigger 与回车分块等。
2. **评审将发现的其他差距**（以评审输出为准，预计覆盖悬停工具栏对位、拖拽体验细节、
   块内导航流畅度等）。

## 验收标准（P3）

1. **产品评审 + 资深开发评审共同打分 ≥ 98 分**（原始目标），评分维度：代码质量/设计标准/
   用户体验/产品竞争力。
2. **IME 合成正确**：中文输入法在 wysiwyg/textarea 编辑中组合期间不误触发打字触发、不误
   分块、不误提交；compositionend 后正常。
3. **交互打磨项按评审差距清单逐项落地**：每项有测试或可验证行为，无回归（526 基线全绿）。
4. **tsc** 无新增错误。
5. **可回滚**：每项独立 commit；不触碰 P0-P2 已收敛的编辑核心逻辑（除非评审确认必要）。

## 明确不做

- 不重构 P0-P2 已交付的架构（registry / undo 栈 / 块模型控制器）——除非评审发现必须且
  以独立任务处理。
- 不做超越对标范围的新功能（如 AI 写作、复杂协作）——聚焦编辑体验本身。

## 关键取舍点（按「代码质量/设计标准/用户体验/产品竞争力」原则自主选定）

- **评审先行**：先量化差距再动手，避免凭感觉打磨；评审输出即 P3 的 prd 补充。
- **IME 优先**：这是明确的、直接影响中文用户的基础缺口，且与编辑收敛路径正交
  （纯事件层防御），风险最低收益最大，先行实施。
- **逐项独立 commit**：每个打磨项独立验证/提交/可回滚，评审可逐项验收。

## 评审差距清单（2026-10-06 产品/开发双评审，只读）

**评审打分**：产品评审 71.5（代码 84/设计 72/体验 62/竞争力 68）；开发评审 79（代码 86/设计 82/体验 73/竞争力 74）。距离 98 分目标的主要差距集中在「WYSIWYG 旗舰路径功能自洽」与「IME 组合」。

### 第一批「稳」（P0-P1，做完约 90 分）
1. **F1/G3 · IME 组合中 Enter 被 slash/emoji 面板吞掉（P0）**：`handleEditorKeyDown` 面板分支（slash/emoji/slashEmoji 3 组，markdown.tsx:3252-3335）无 isComposing 守卫，而委托的 `inlineEditKeyDown` 有守卫——面板开启时 IME 保护失效。组合中 Enter 确认候选词会被 `preventDefault` + `handleSlashPick` 吞掉插入命令块。修：面板分支入口加 `if (e.nativeEvent.isComposing) return;`。
2. **F2/G2/F11 · WysiwygEditor 无 composition 守卫（P1）**：全文无 onCompositionStart/End；`handleInput` 每次 input（含 compositionupdate）执行 `detectTypingTrigger`（DOM 手术）+ `syncMirror`（`sentinelMarkdownCaret` 插/删哨兵节点 + `root.normalize()`，打断 IME 组合）。blur 立即序列化提交，组合未落盘丢最后一个词。修：`compositionActiveRef` 组合中跳过 sentinel/类型转换/DOM 手术，仅 compositionend 后 sync；blur 等组合落盘。
3. **G1 · WYSIWYG 列表 Enter 死键（P1）**：`handleEnterSplit` 对 wysiwyg list 提前 return（注释称原生建 li），但 `makeInlineEditKeydown` 已 `preventDefault()` → 原生被吞，无兜底。修：Enter 分支先判 `session.wysiwyg && blockKind==="list"` 不 preventDefault 放行原生。
4. **F4 · WYSIWYG 空列表项退格 = 关编辑器（P1）**：共享 keydown 空稿 Backspace → `handleNavigateUp` 对 list 直接 `cancel()`，空项残留焦点丢失（浏览器原生合并被吞）。修：WYSIWYG list 会话跳过 onNavigateUp，空稿退格放行原生。
5. **F3/G5 · WYSIWYG 路径无 onPaste，贴图丢（P1）**：`handleEditorPaste` 只接 textarea；WysiwygEditor 无 onPaste → 粘贴图片 blob `<img>` 进 contentEditable → 序列化输出 `![alt](blob:)` 写入源码，blob 失效图片永久丢失、文件被污染。修：WysiwygEditor 加 onPaste 复用 `handleEditorPaste` 的 assets 落盘 + DOM 插入；blob:/data: URL 拒绝序列化。

### 第二批「顺」（P1-P2，冲刺 98）
6. **G4 · WYSIWYG 下 FloatingToolbar 永不显示（P1）**：`inlineSelection` 只在 textarea 的 `selEnd > caret` 设置；WYSIWYG onCaretChange 永远折叠光标。WysiwygEditor 无 selectionchange 上报。修：加 selectionchange → onCaretChange(start,end)；toolbarAnchor 用选区 rect。
7. **G6 · WYSIWYG 下 emoji 插入静默丢失（P1）**：`handleEmojiPick`/`handleSlashEmojiPick` 只改 draftText 镜像不改 DOM → blur 以 DOM 序列化为准 → emoji 丢失 `::query` 残留。修：WYSIWYG 分支 DOM 删触发前缀插 emoji + syncMirror。
8. **F5 · 行内格式「所见≠所得」（P1）**：键入 `**bold**` 显示字面量，提交后才变；无 live inline conversion、无字面量转义。修：detectTypingTrigger 扩展到 `**`/`*`/`` ` ``/`~~` + dom-to-markdown 字面量转义。
9. **F6/G8 · 跨块方向键导航缺失（P1/P2）**：块首/块尾 ↑/↓ 不跨块移动光标。修：session 内接管边界方向键 → focusEditedLine(prev/nextLine)。
10. **G10 · P3 交互未收敛到块模型（P2）**：插入/拖拽/删除仍裸字符串；新增交互应复用 controller intent（insert-block/move-block/delete-block）。
11. **F7/G7 · 拖拽无嵌套/ghost（P2）**：drop 只有 before/after，拖入列表嵌套缺失。修：dropTarget `inside` 模式 + 幽灵预览。
12. **F9/G9 · 列表 Tab 缩进缺失（P2）**：keydown 增 Tab 分支（AST 级缩进变换）。
13. **G12 · `applyInlineStyle("code")` 用 surroundContents 可抛 InvalidStateError（P2）**：选区跨非文本节点时崩溃，加 try/catch 或改用 insertNode。
14. **F12 · 交互层测试覆盖薄（预防）**：为 F1/F2/F4/G1 各补回归测试。
