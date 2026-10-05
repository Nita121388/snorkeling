# P2-B1 Implement Plan

## 状态：实施完成 ✓（2026-10-05，已过 trellis-check 审查）

## 已交付
- markdown.tsx 的 onApplyLanguage 从「直接 setCodeBlockLanguage」改为「走 P2-A 编辑控制器
  （set-code-lang intent）」，打通真实编辑 → 控制器 → 文本变换 → undo 栈最小闭环。
- 模块级单例 `const editorController = createEditController()`。
- 等价性核实（trellis-check）：session.startLine(1-based) → Block.startLine-1(0-based) →
  控制器 +1 还原 1-based → setCodeBlockLanguage idx = startLine-1，与现状完全一致，无 off-by-one。
- undo 覆盖：仍走 handleInlineEditCommit，改语言后 Cmd+Z 可撤销。

## 验证
- element 39 文件 / 509 测试全绿（508 基线 + 1 新增非首行代码块换算测试）。
- tsc 无新增错误（仅预存在 markdown.tsx loadable 报错）。

---

## 目标

把 code 语言的线上提交通道（markdown.tsx onApplyLanguage）从「直接 setCodeBlockLanguage」
改为「走 P2-A 编辑控制器（set-code-lang intent）」，打通「真实编辑 → 控制器 → 文本变换 →
undo 栈」最小闭环，作为后续 prose/list 收敛的模板。行为零变化、可回滚。

## 已核实的 based 语义（成败关键，勿改）

| 符号 | based | 说明 |
|---|---|---|
| `setCodeBlockLanguage(text, line, lang)` 的 `line` | **1-based** | `idx = trunc(line)-1` |
| `inlineEdit.editSession.startLine` | **1-based** | `safeLine = max(1, trunc(line))` |
| `Block.startLine`（buildBlockTree） | **0-based** | "0-based, inclusive" |
| P2-A 控制器 `set-code-lang` 内部 | Block.startLine+1 → 1-based | 已正确 |

**结论**：P2-A 控制器期望 Block 是 0-based；现状 onApplyLanguage 直接用 1-based session.startLine。
收敛时调用方须把 1-based session.startLine **转成 0-based Block.startLine**（`-1`），让控制器内部
+1 还原为 1-based。

## Step 1 markdown.tsx 接入控制器

1. 模块级持有控制器实例：`const codeBlockEditController = createEditController();`（纯函数工厂，
   无 React 依赖，可放模块顶层或文件内常量）。
2. onApplyLanguage 改为：
```ts
const nextLang = ...;
setEditCodeLanguage(nextLang);
const sl1 = inlineEdit.editSession.startLine;      // 1-based
const block: Block = {
    id: `code:${sl1}`,
    kind: "code",
    startLine: sl1 - 1,                            // → 0-based（控制器内部 +1 还原 1-based）
    endLine: sl1 - 1,
    depth: 0,
    text: inlineEdit.editSession.initialContent ?? "",
    children: [],
};
const res = codeBlockEditController.apply({ type: "set-code-lang", block, lang: nextLang }, { text });
if (res != null) handleInlineEditCommit(res.text);
```

## Step 2 测试

- 依托既有 markdown.tsx 代码语言相关测试（若有）确认无回归；编辑器行为不变。
- 新增 P2-A controller 的 set-code-lang 已有测试（block 0-based → line1 1-based），确认控制器
  侧正确；P2-B1 侧重「markdown.tsx 的 sl1-1 转换」正确性。可在 editor-controller.test 补一个
  「1-based 会话行号 → 0-based Block」的换算测试。

## 校验门
- [ ] 既有 508 element 测试全绿（含 code 语言相关）
- [ ] tsc 无新增错误
- [ ] 行为等价：改语言的 done（严格等价现状，undo 栈已覆盖）
- [ ] 可回滚：单点改动，异常 revert 无副作用

## 提交
- 单 commit。提交前 `pwd && git branch --show-current`。
- 关联 task 10-05-p2-b-converge-edits。