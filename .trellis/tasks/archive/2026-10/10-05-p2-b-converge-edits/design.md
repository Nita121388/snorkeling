# P2-B1 Design: 编辑提交收敛的最小闭环（code 语言切入点）

## 现状边界

- code 语言的 `onApplyLanguage` 在 markdown.tsx（4395 附近）直接调 `setCodeBlockLanguage(text, startLine, nextLang)` → `handleInlineEditCommit(next)`（已进 undo 栈）。
- `startLine` 来自 `inlineEdit.editSession.startLine`（0-based 行号）。
- P2-A 已有 `createEditController` + `set-code-lang` intent，内部用 Block.startLine+1（1-based）调 `setCodeBlockLanguage`。
- 会话 startLine 是 0-based，Block.startLine 也是 0-based。**行号体系一致**，只需 0→1 转换（控制器内部已做 `line1 = block.startLine + 1`）。

## 设计决策

### 决策 1：起点选 code 语言（最小闭环模板）

**理由**：
- 最独立：无 contentEditable 参与、单行、已有确定性纯函数 `setCodeBlockLanguage`。
- 风险最低：现调用点只有一处（onApplyLanguage），改造可快速回滚。
- 价值清晰：证明「真实编辑 → P2-A 控制器 → 文本变换 → undo 栈」链路可用，为 prose/list 收敛当模板。

### 决策 2：收敛动作 = 把 onApplyLanguage 改为走编辑控制器

**现状**（markdown.tsx onApplyLanguage）：
```ts
const next = setCodeBlockLanguage(text, session.startLine, nextLang);
if (next != null) handleInlineEditCommit(next);
```

**改为**：
```ts
const ctl = editorController; // createEditController() 实例（markdown.tsx 持有）
const block: Block = { id:`code:${sl}`, kind:"code", startLine: sl, endLine: sl, depth:0, text: ..., children: [] };
const res = ctl.apply({ type:"set-code-lang", block, lang: nextLang }, { text });
if (res != null) handleInlineEditCommit(res.text);
```

**关键点**：控制器内部把 `block.startLine+1`（1-based）传给 `setCodeBlockLanguage`。会话 startLine 是 0-based，Block.startLine 填同样的 `sl` 即可（控制器 +1）。行为与现状**完全等价**。

**等价性论证**：现状 `setCodeBlockLanguage(text, sl, lang)`（sl 是 0-based？需确认）。控制器 `setCodeBlockLanguage(text, line1, lang)` 其中 `line1 = block.startLine+1`。若现状传的是 0-based `sl`，控制器必须也产出 1-based。**需在实现时核实 setCodeBlockLanguage 的 line 语义**（1-based 还是 0-based），避免 off-by-one。

### 决策 3：controller 实例由 markdown.tsx 持有（一次创建）

`createEditController()` 是纯函数工厂，无状态，可在 Markdown 组件外模块级创建单例（或 useMemo）。返回的 apply 不依赖 React。放模块级常量最简。

## 兼容与风险

- 风险 LOW（本子步）：单点改造、行为等价、可回滚。
- 需核实 line 语义边界（setCodeBlockLanguage 的 startLine 是 1-based——P2-A 测试已验证 `"```js\n...```"` 用 block.startLine=0 → line1=1 正确改写，说明它是 1-based；而 onApplyLanguage 现传 `session.startLine`，若那是 0-based 则现状本身可能已差 1？**必须在实现时验证**）。
- undo 复用：handleInlineEditCommit 已进 undo 栈，无额外改动。

## 不做

- 不改 wysiwyg-editor / prose / 列表收敛（P2-B2/B3）。
- 不解决 R1（列表项作用域）。
- 不改表格/代码编辑器本体。