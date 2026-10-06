# P2-B2 Design: prose 块编辑提交收敛到编辑控制器（replace-content intent）

## 现状边界（已勘察）

**WysiwygEditor（contentEditable）完整链路：**

```
用户编辑
  → WysiwygEditor.handleInput
    → detectTypingTrigger()（live-kind 转换：p→h/list/quote，改 DOM + 同步）
    → syncMirror()
      → const md = serializeBlockDomToMarkdown(root, commitCtx())   // DOM 反序列化
      → const caret = sentinelMarkdownCaret(root, commitCtx())
      → onInput(md, caret)
        → markdown-inline-edit InlineEditOverlay.onInput
          → onTextChange(md, caretMd) → setDraftText(md)          // draftText = 反序列化 md
  → WysiwygEditor.handleBlur
    → const md = serializeBlockDomToMarkdown(root, commitCtx())
    → onBlur(md)
      → markdown-inline-edit InlineEditOverlay.onBlur → commit(md)
        → markdown.tsx onBlur={inlineEdit.commit}
          → commit(newFull)
            → handleInlineEditCommit(newFull)                      // P1 undo 栈收敛点
```

**commit() 中 prose 的替换定位**（markdown-inline-edit.tsx 902-909）：
```ts
} else {
    const originalSource = fullTextRef.current.split(/\r?\n/).slice(startLine-1, endLine).join("\n");
    const sourceDraft = current.blockKind === "code" ? wrapCodeFence(...) :
                        current.blockKind === "list" ? wrapListMarker(...) : committedDraft;
    newFull = replaceSourceRange(fullTextRef.current, current.startLine, current.endLine, sourceDraft);
}
onCommit(newFull);
```
- `startLine/endLine` 是 1-based 会话行号。
- `replaceSourceRange(text, start, end, segment)` 按行替换，保留 EOL（dominant 风格）。
- 对 p/h/quote/blank：`sourceDraft === committedDraft`（即 DOM 反序列化 md，已是完整块 markdown：h 带 `# `，quote 带 `> `）。

**关键语义**：prose 的 `committedDraft`（DOM 反序列化产物）已经是**完整的目标块 markdown 文本**，
提交本质 = 用这块新文本替换源码里的旧块。这与 P2-B1 的「确定性变换」不同——它不是「从某个
old 转成 new」，而是「整体替换新内容」。因此需要独立 `replace-content` intent。

## 设计决策

### 决策 1：新增 `replace-content` intent（控制器）

`BlockEditIntent` 增加：
```ts
| { type: "replace-content"; block: Block; content: string }
```
控制器 `apply` 分支：
```ts
case "replace-content": {
    const { start, end } = lineRangeToCharOffset(text, block.startLine, block.endLine);
    const next = text.slice(0, start) + intent.content + text.slice(end);
    return { text: next, caret: start + intent.content.length };
}
```
- `lineRangeToCharOffset` 已是 P2-A 交付（0-based inclusive 行范围 → 绝对字符偏移）。
- `end` 是该块**该行内容结尾（不含末尾换行）**；`text.slice(end)` 从块内容结束后继续，保留块后
  的换行/后续内容。与 `replaceSourceRange` 的「整范围行替换」语义对齐（块末换行由 slice 保留）。

### 决策 2：`replace-content` 与 `replaceSourceRange` 的等价性

需在单测核实两者对同一 [startLine..endLine] + content 产出相同文本（尤其多行块、EOL 保留）。

- `replaceSourceRange`：按行切（split /\r\n|\n/），替换 [startLine..endLine]（1-based inclusive）
  为 content 的行，按 dominant EOL 重 join。
- `lineRangeToCharOffset`：按 \n 切出绝对偏移，原样 slice 替换（保留原 \r\n 不动，只替换内容段）。

**差异点**：replaceSourceRange 会统一块内 EOL（按文件 dominant）；lineRangeToCharOffset 替换段内
保留原样（\n 分割因 split 用 \n，段内多行 content 用 \n join，块边缘保持前一行 \r\n 不动）。
实际 wave 保存用 \n（dom-to-markdown 注释已述），多行块内容都是 \n。单测确认等价性即可。

### 决策 3：控制器单例下沉到模块共享

P2-B1 在 markdown.tsx 模块级 `const editorController = createEditController()`。prose 收敛点在
`markdown-inline-edit.tsx` 的 commit（useInlineEdit 内部），两处需共享同一实例。

方案：在 `block-model/` 新建一个**单例导出**（如 `editor-controller-instance.ts`）：
```ts
export const editorController = createEditController();
```
markdown.tsx 与 markdown-inline-edit.tsx 都 import 它。P2-B1 的 markdown.tsx 本地实例改引此单例
（保持等价，实例无状态）。

> 取舍：也可用 context/module 注入，但模块级单例最简、无状态纯函数、无 React 依赖，
> 符合 P2-B1 既定模式。React 组件层无需感知。

### 决策 4：仅收敛 wysiwyg 会话，textarea 路径不动

`commit()` 里增加分支：当 `current.wysiwyg`（WYSIWYG 会话）且块种类是 prose（p/h/quote/blank，
即非 list/code/table 且非 placeholder/insertMode）时，改走控制器 replace-content；否则保持
`replaceSourceRange`。

判定逻辑建议在 commit 内用 `session.wysiwyg && WYSIWYG_PROSES.includes(session.blockKind)`。
list/table/code 有专门序列化路径，不在本步收敛（list 是 P2-B3）。

### 决策 5：Block 构造（基于语义，复刻 P2-B1）

```ts
const block: Block = {
    id: `prose:${sl0}:${el0}`,
    kind: current.blockKind,           // "p" | "h" | "quote" | "blank"
    startLine: current.startLine - 1,  // 1-based → 0-based
    endLine: current.endLine - 1,
    depth: 0,
    text: current.initialContent ?? "",
    children: [],
};
```
kind 注意：TreeBlockKind 含 "text"（段落）。wysiwyg 的 blockKind 是 InlineEditBlockKind "p"。
buildBlockTree 对段落产出 kind "text"。控制器 replace-content 不依赖 kind（仅用坐标），但为一致
传 blockKind 或映射 "p"→"text"。建议映射：`kind: blockKind === "p" ? "text" : blockKind`。

## 兼容与风险

- 风险 MEDIUM（较 P2-B1 高）：prose 是最常用编辑块，涉及多行/soft-break/空内容/回车分块。
  需覆盖边界测试。
- undo 复用：仍走 handleInlineEditCommit，P1 undo 栈不变。
- 双轨：textarea 路径、list/table/code 路径零改动；wysiwyg prose 单点收敛，可回滚。
- **量化验证**：单测覆盖 `replace-content` 与 `replaceSourceRange` 对典型 prose 输入等价；
  集成不改 wysiwyg-editor 本体，行为不变。

## 明确的等价性验证用例（单测）

1. 单行段落：`"hello"` 单行替换，等价。
2. 多行 soft-break 段落：endLine > startLine，整块替换。
3. 标题：content 含 `# ` 前缀，替换后等价。
4. 引用：content 含多行 `> `，等价。
5. 块前有内容、块后紧跟下一块（中段块），替换不吞换行/后续块。
6. EOL：文件 \r\n 时，替换段内 \n 内容后，块边缘 \r\n 保留（与 replaceSourceRange dominant 语义
   的差异在单测中明确断言，若不等价则保留 replaceSourceRange 分支）。
7. 空内容提交（块删空）：content=""，替换行为与现状一致。

## 不做

- 不改 wysiwyg-editor.tsx（交互/序列化保留）。
- 不收敛 list（P2-B3） / table / code / textarea。
- 不解决 R1 / R2。