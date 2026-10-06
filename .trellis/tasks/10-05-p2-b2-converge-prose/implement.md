# P2-B2 Implement Plan

## 状态：实施完成 ✓（待 check）

## 实施记录（2026-10-05）

- Step 0：新建 `block-model/editor-controller-instance.ts` 模块级单例；markdown.tsx 本地实例改引单例；
  markdown-inline-edit.tsx import 同一实例。block-model/index.ts 不转发导出单例（避免依赖环）。
- Step 1：`BlockEditIntent` 新增 `replace-content` intent，控制器分支用 `lineRangeToCharOffset`
  做绝对字符偏移替换，返回 `{ text, caret }`（caret 落在替换内容末尾）。
- Step 2：commit() 新增 wysiwyg-prose 分支（`current.wysiwyg && p/h/quote/blank`），构造 0-based
  Block（kind 经 `inlineKindToTreeKind` 映射：h 从 committedDraft `#` 前缀推断级别，quote→quote，
  p/blank→text），调 `editorController.apply({type:"replace-content",...})` → onCommit →
  handleInlineEditCommit（P1 undo 栈）；res==null 时 fallthrough 到原 replaceSourceRange。
- Step 3：editor-controller.test.ts 新增 9 个 replace-content 用例（单行/中段/多行/拼接/越界/
  caret/CRLF），其中等价性用例与 production `replaceSourceRange` 的逐行复刻 `refReplace` 对比断言。
  实测：39 文件 / 516 测试全绿（基线 509）；tsc 无新增错误（仅预存在 markdown.tsx(448,52)
  loadable 错误）。
- 已知差异：CRLF 文件下 replace-content 与 replaceSourceRange 有边界 EOL 差异（
 归属块行、
 是分隔符），
  wave 保存一律 \n，非生产场景，已在测试注释与控制器注释注明。

## 目标

把 prose 块（p/h/quote/blank）WYSIWYG 编辑的提交定位，从「裸行号 `replaceSourceRange`」
收敛到「块模型编辑控制器」（新增 `replace-content` intent）。内容来源仍是 DOM 反序列化
（wysiwyg-editor 本体不改），收敛的是提交通道/定位 → 统一到块模型 + undo 栈模式。

## Step 0 前置：控制器单例共享

新建 `block-model/editor-controller-instance.ts`：
```ts
import { createEditController } from "./editor-controller";
export const editorController = createEditController();
```
- markdown.tsx 移除本地 `const editorController = createEditController()`，改从该模块 import
  （P2-B1 逻辑等价，实例无状态）。
- markdown-inline-edit.tsx 从此模块 import `editorController`。
- block-model/index.ts 不导出单例（避免形成多方依赖环；由消费方显式 import instance 模块）。

## Step 1 controller 新增 replace-content intent

`editor-controller.ts`：
1. `BlockEditIntent` 增加 `| { type: "replace-content"; block: Block; content: string }`。
2. `createEditController().apply` 增加分支：
```ts
case "replace-content": {
    const { start, end } = lineRangeToCharOffset(text, block.startLine, block.endLine);
    const next = text.slice(0, start) + intent.content + text.slice(end);
    return { text: next, caret: start + intent.content.length };
}
```

## Step 2 prose commit 收敛

`markdown-inline-edit.tsx` commit() 里，在 `const newFull` 计算处（原 else 分支 replaceSourceRange
之前），新增 wysiwyg-prose 分支：

```ts
} else if (
    current.wysiwyg &&
    (current.blockKind === "p" || current.blockKind === "h" ||
     current.blockKind === "quote" || current.blockKind === "blank")
) {
    const sl0 = current.startLine - 1;   // 1-based → 0-based
    const el0 = current.endLine - 1;
    const block: Block = {
        id: `prose:${sl0}:${el0}`,
        kind: current.blockKind === "p" ? "text" : current.blockKind,
        startLine: sl0,
        endLine: el0,
        depth: 0,
        text: current.initialContent ?? "",
        children: [],
    };
    const res = editorController.apply({ type: "replace-content", block, content: committedDraft }, { text: fullTextRef.current });
    if (res != null) { onCommit(res.text); return; }
    // res == null 理论不发生（坐标合法即成功）；兜底 fallthrough 到原 replaceSourceRange
}
```
- `current.wysiwyg` 是 InlineEditSession 的 wysiwyg 标记（已存在，方案 08）。
- 其余（list/table/code/textarea）走原逻辑不动。

## Step 3 测试

1. `editor-controller.test.ts` 新增 replace-content 用例（等价性见 design 决策 6 的 6 条）：
   - 单行段落、多行 soft-break、标题（# 前缀）、多行引用（> 前缀）、中段块、空内容、EOL。
   - 与 `replaceSourceRange` 输出对比断言等价（或明确断言差异并保留分支）。
2. markdown-inline-edit / state 测试：确认 wysiwyg-prose 分支触发正确（若已有 wysiwyg commit 测试）。

## 校验门
- [ ] 既有 509 element 测试全绿（含 prose 相关）
- [ ] tsc 无新增错误
- [ ] 行为等价：wysiwyg prose 提交严格等价现状（undo 栈覆盖不变）
- [ ] 可回滚：textarea/list/table/code 零改动；wysiwyg prose 单点

## 提交
- 单 commit。提交前 `pwd && git branch --show-current`。
- 关联 task 10-05-p2-b2-converge-prose。