# P3 Design: 交互质感打磨（IME 优先 + 评审驱动的差距清单）

## 阶段结构

```
P3 = 评审差距分析（子代理，产出差距清单）
   + IME 合成处理（已知缺口，先行实施）
   + 差距清单逐项打磨（每项独立 commit）
   + 终审：产品评审 + 资深开发评审打分 ≥ 98
```

## 决策 1：IME 合成处理设计（先行）

**问题**：中文/日文输入法 composition 期间，`detectTypingTrigger`（wysiwyg-editor handleInput
里检测 live-kind 转换：p→h/list/quote）、回车分块（handleEnterSplit）、blur 提交都可能被
composition 中间状态的文本触发：

- 输入法组合中把 `#` 选为候选（如输入 `#` 后尚未确认）→ detectTypingTrigger 误把段落
  转成标题并改写 DOM → IME 状态破坏、光标丢失。
- 组合中按 Enter 选候选词 → 被当作「回车分块」→ 块被错误拆分。
- 组合中 blur（点别处）→ 中间态文本被提交。

**方案（事件层防御，不改编辑内核）**：

1. **composition 状态标记**：editor 持有 `composingRef`（布尔），
   `onCompositionStart` 置 true，`onCompositionEnd` 置 false。React 的 onCompositionEnd
   在确认后触发，此时事件序列为 compositionend → input，故 input 处理时看到 composing
   已复位，可正常处理。
2. **detectTypingTrigger 守卫**：`if (composingRef.current) return;` —— 组合期间不做
   live-kind 转换。
3. **回车分块守卫**：handleEnterSplit / wysiwyg 的 Enter 处理里，`if (composingRef.current)
   return;`（或交给原生行为）——组合中使用 Enter 选候选词不触发分块。注意：React 中
   Enter 键事件在 composition 中按下时 `e.nativeEvent.isComposing` 为 true，这是更可靠的
   判断——**优先用 `e.nativeEvent.isComposing`**，ref 作兜底（wysiwyg 合成事件路径）。
4. **blur 提交守卫**：blur 时若仍在组合（composingRef.current），延迟/放弃提交？——思源
   的做法是组合中不提交；但 blur 已发生，稳妥做法：若 composing，等待 compositionend 后
   再提交（短延迟或忽略本次 blur）。**设计取舍**：WYSIWYG blur 提交是核心路径，组合期间
   blur 罕见；先做「组合中 blur 不提交（preserve DOM 状态，等 compositionend 由 input
   同步）」，textarea 路径组合中 blur 已由原生管理（textarea 的 value 不受 composition
   影响，直接提交即可）——**仅 WYSIWYG 路径需要守卫**。

**实现落点**：
- `wysiwyg-editor.tsx`：加 composition 事件 props 或内部处理。
- `markdown-inline-edit.tsx` / `markdown.tsx`：Enter 分块处读 `isComposing`。
- 不改 P0-P2 的控制器/undo/渲染核心。

**测试**：以 jsdom 模拟 composition event（dispatchEvent new Event('compositionstart')），
验证：组合中 typing-trigger 不触发、Enter 不分块；compositionend 后恢复正常。
（jsdom 对 isComposing 支持有限，test 用 ref 标记路径验证 + 逻辑层断言。）

## 决策 2：评审流程设计

**评审子代理输出**（对照思源 SiYuan 桌面端 / 我来 Wolai 的块编辑体验）：

1. **悬停工具栏对位**：思源/我来的块 hover 是否有未实现的 affordance（如块左侧 hover 出
   「拖拽 + 更多」组合、块边缘插入按钮的对位、选中块后的操作条）。
2. **拖拽体验**：拖拽指示线、跨列表拖入嵌套、拖到块边缘插入 vs 块间重排的区分。
3. **块内导航**：行内上下移动、跨块 Tab/Shift+Tab、退格合并、Esc 取消链路的完整度。
4. **IME**：确认设计（composition 守卫）覆盖足够。
5. **其他**：影响 98 分体验的细节缺陷清单。

**评审输出格式**：差距清单（每项：差距描述 / 对标行为 / 建议 / 优先级 P0-P2 / 影响打分
程度）。P0 级差距必须解决，P1/P2 级按「打分影响」取舍。

## 决策 3：逐项打磨的工程纪律

- 每项一个独立 commit（或同批低风险小项），先测试后提交。
- 不动 P0-P2 收敛核心（控制器/undo/registry）除非评审判定必须。
- 每项打磨必须说明「对标行为」与「可验证结果」。

## 验收

- IME：组合中不误触发/不误分块/不误提交，compositionend 后正常（测试覆盖）。
- 评审差距清单：P0 项全部解决，P1 项解决主要部分（打分 ≥98 为准）。
- 526 基线测试全绿 + 新增测试；tsc 无新增错误。