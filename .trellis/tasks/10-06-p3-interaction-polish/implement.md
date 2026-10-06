# P3 Implement Plan

## 状态：实施中（第一批「稳」完成，第二批「顺」进行中）

## 实施记录（2026-10-06）

### 评审差距分析（已完成）
产品评审 71.5 分（代码 84/设计 72/体验 62/竞争力 68）；开发评审 79 分（代码 86/设计 82/
体验 73/竞争力 74）。差距清单 14 项（F1-F12 产品 / G1-G12 开发，合并去重后 13 项），已写入
prd.md 补充。核心差距：WYSIWYG 旗舰路径功能自洽 + IME 组合。

### 第一批「稳」（commit d97adad8，已完成）
- F1/G3：slash/emoji/slashEmoji 面板分支入口加 isComposing 守卫。
- F2/G2/F11：WysiwygEditor composition 生命周期守卫（组合中禁 DOM 手术，blur 等落盘）。
- G1：makeInlineEditKeydown allowNativeEnter（wysiwyg list Enter 放行原生建 li，修死键）。
- F4：allowNativeBackspaceOnEmpty（wysiwyg list 空项退格放行原生合并）。
- F3/G5：savePastedImageToAssets 公共 helper + WysiwygEditor onPaste + insertTextAtCaret。
- 回归测试 +7；39 文件 / 533 测试全绿；tsc 68 基线不变。

### 第二批「顺」（commit b3bca1ba，已完成）
- G4：WYSIWYG 下 FloatingToolbar 永不显示 —— sentinelMarkdownSelection（选区两端哨兵）+
  document selectionchange 上报 + handle.getSelectionRange；overlay onCaretChange(start,end)
  到达 markdown.tsx → 工具栏在 WYSIWYG 路径可用（组合中不上报）。
- G6：WYSIWYG 下 emoji 静默丢失 —— handleEmojiPick/handleSlashEmojiPick 加 WYSIWYG 分支
  （DOM 是事实源）：deleteCharsBeforeCaret 删 ::query 前缀 + insertTextAtCaret 插 emoji。
- F6/G8：跨块方向键导航 —— getNextBlockLine + handleNavigateUpCrossBlock/handleNavigateDown；
  makeInlineEditKeydown 加 onNavigatePrev/Next + getCaretPos/getTextLen（块首↑/块尾↓跨块）。
- F9/G9：列表 Tab/Shift+Tab 缩进 —— indentListRange 纯函数（2 空格步进，仅 marker 行）+
  onIndentList；wysiwyg list 保持原生。
- G12：applyInlineStyle(code) surroundContents 跨节点选区崩溃 —— try/catch 保护。
- 回归测试 +13；39 文件 / 546 测试全绿；tsc 68 基线不变。

### 第二批剩余（deferred 评估）
- F5（live inline conversion + 字面量转义）：已在本轮完成（见下方「第四批」）。
- F7/G7（拖拽嵌套 + ghost 预览）：已在本轮完成（见下方「第四批」）。
- G10（交互收敛到 controller intent：insert/move/delete block）—— **决策：不做**。
  理由（代码质量/设计标准原则）：
  1. insert/move/delete 已是纯函数 + 统一提交通道（spliceInsertBlock / moveBlockRange /
     deleteBlockRange → handleInlineEditCommit → P1 undo 栈），行为与架构目标一致；
  2. 这些是**跨块范围操作**（一次拖动 N 块、一次删一整列表），而 Block 模型是**单块坐标**
     （startLine/endLine + 意图）——强塞 intent 会扭曲 P2 建立的块模型契约；
  3. intent 包装无功能收益，只增加一层间接与测试面，降低而非提升代码质量。
  如未来需要（如嵌套列表的 AST 级操作），应先扩展块模型支持范围操作，而非包一层 intent。

### 终审（2026-10-06）
产品评审 **90.5**（代码 95/设计 93/体验 88/竞争力 86）；开发评审 **82.5**（代码 88/设计 84/
体验 78/竞争力 80）。未达 98；共识差距按影响：F10 工具栏锚选区（最直观）→ F5 live 格式
转换 → F7 拖拽嵌套 → WYSIWYG list Tab 死键 → G10 收敛 → selectionchange 性能 →
WYSIWYG 单测空白 → 组合中切块陈旧提交/串块风险（P1）。

### 第三批（commit 2d4b2650，终审发现项修复，已完成）
- WYSIWYG 列表 Tab 死键：handleIndentList wysiwyg 分支改走 applyListIndent（execCommand
  indent/outdent → 原生嵌套 → 序列化重输出缩进 marker）。
- 性能（P2-4）：makeInlineEditKeydown caret/textLen 惰性求值（仅方向键/Tab 时计算，
  普通键击不再 2 次全量序列化）。
- P1 串块风险：commit() wysiwyg 会话 content 缺失时优先 DOM 序列化 getMarkdown()，
  不再用组合前陈旧 draftText（消除切块丢字/串块覆写）。
- 回归测试 +1；39 文件 / 547 测试全绿；tsc 68 基线不变。

### 第四批（F7 b559d68e + F5 209765a6 + 修复 e973be6d，已完成）
- F7：moveBlockRange 新增 inside 模式（拖拽嵌套，缩进对齐保留相对层级）+ 左 25%
  嵌套区判定 + 虚线框指示；check 修复：inside 候选用 hovered LI 自身（不 promote），
  修含子列表 LI 拖入目标错位。+4 测试。
- F5：detectClosedInlinePair 纯函数 + applyClosedInlineFormatting（输入 **bold** 光标
  到末尾即转 <strong> 等，同文本节点最小 DOM 手术，防御性跳过 + IME 守卫）；
  check 修复：光标用父容器定位（不依赖 nextSibling）。+11 测试（纯函数）。
- 39 文件 / 562 测试全绿（547 + 15）；tsc 68 基线不变。

## 目标

交互质感打磨（对标思源/我来）。评审差距分析 → IME 守卫先行 → 差距清单逐项实施 → 终审打分 ≥98。

## Step 1 评审差距分析（子代理）

派「产品评审」+「资深开发」子代理对照思源/我来评估现有交互完成度：
- 输出差距清单（每项：差距/对标行为/建议/优先级 P0-P2/打分影响）
- 评审需要读：markdown.tsx 交互区块（Block grip/insert/drag/selection、FloatingToolbar、
  slash、emoji、table toolbar、Enter/ArrowUp 导航、link tooltip、paste image）、
  wysiwyg-editor.tsx、markdown-inline-edit.tsx、HANDOFF.md P3 定义。
- 评审结果写入本任务 prd.md 补充（或独立 gap-analysis 文档）。

## Step 2 IME 合成守卫（先行，已知缺口）

按 design 决策 1 实施：
- wysiwyg-editor.tsx：composition start/end 标记 + detectTypingTrigger 守卫。
- 回车分块处（markdown.tsx handleEnterSplit / wysiwyg Enter 路径）：`isComposing` 判断。
- WYSIWYG blur 提交：组合中不提交（等待 compositionend 由 input 同步）。
- 测试：jsdom 模拟 composition 事件，验证组合中不误触发/不误分块，compositionend 后正常。

## Step 3 差距清单逐项打磨

按评审输出 P0 优先逐项实施，每项独立验证/commit：
- 每项：先补测试/行为断言 → 实施 → 全量测试 + tsc。
- 不动 P0-P2 收敛核心（控制器/undo/registry），除非评审判定必须。

## Step 4 终审

产品评审 + 资深开发评审重新打分（维度：代码质量/设计标准/用户体验/产品竞争力），
≥98 分完成；不足则回到 Step 3 补差距。

## 校验门

- [ ] IME：组合中不误触发/不误分块/不误提交，compositionend 后正常（测试覆盖）
- [ ] 评审 P0 差距项全部解决
- [ ] 526 基线测试全绿 + 新增测试
- [ ] tsc 无新增错误
- [ ] 终审打分 ≥ 98

## 提交

- 每个独立打磨项一个 commit；提交前 `pwd && git branch --show-current`。
- 关联 task 10-06-p3-interaction-polish。
