# P2-B3 Design: 列表块编辑提交收敛到编辑控制器（replace-content 复用 + 修复重复 marker）

## 现状边界（已勘察实测）

**WYSIWYG list 完整链路：**

```
点击列表项
  → resolveEditTargetFromEl：li（无嵌套子列表）→ 单项 target；有嵌套 → 整组 ul/ol target
  → inlineEdit.beginEdit("list", line, target)
    → sourceContent = lines.slice(startLine-1, endLine).join("\n")
    → initialContent = stripListMarker(sourceContent)          // 只去首行 marker
    → captureWysiwygInfo("list", target, ...) → wysiwygHtml = target.outerHTML
  → WysiwygEditor 编辑（contentEditable，root 内是 ul/li 或 li 结构）
  → 每次 input：serializeBlockDomToMarkdown(root, ctx) → serializeListDomToMarkdown
    → 产物 = 完整列表 markdown，**每行含 marker**（"- apple\n- PEAR"）
    → onInput(md) → draftText = md
  → blur：serializeBlockDomToMarkdown → onBlur(md) → commit(md)
    → committedDraft = md（含 marker）
    → else 分支：sourceDraft = wrapListMarker(committedDraft, originalSource)
      → originalSource 首行 marker 再包一遍 → **"- - apple\n- PEAR"（重复 marker bug）**
    → newFull = replaceSourceRange(fullText, startLine, endLine, sourceDraft)
```

**重复 marker bug 实测证据（已用 vitest jsdom 验证）：**
- `serializeBlockDomToMarkdown(<ul><li>apple</li></ul>, {kind:"list"})` = `"- apple"`
- `wrapListMarker("- apple", "- apple")` = `"- - apple"`（bug）
- textarea 路径（draftText 为用户手输无 marker）的 wrapListMarker 正确，不动。

**根因**：WYSIWYG 的 DOM 序列化已把 marker 写入产物（这是正确设计——marker 不在 DOM 里，
必须回写源码），commit 不再需要 wrapListMarker 补 marker。而现状 else 分支对**所有** list
提交（含 WYSIWYG）统一 wrapListMarker，导致 WYSIWYG 路径重复。

## 设计决策

### 决策 1：复用 `replace-content` intent，收敛 WYSIWYG list 提交

与 P2-B2 完全相同的收敛模式（P2-B2 已在 commit() 实现 wysiwyg-prose 分支），把分支条件
从 prose 扩展到 list：

```ts
} else if (
    current.wysiwyg &&
    committedDraft.length > 0 &&
    (current.blockKind === "p" ||
        current.blockKind === "h" ||
        current.blockKind === "quote" ||
        current.blockKind === "blank" ||
        current.blockKind === "list")   // ← P2-B3 新增
) {
    const sl0 = current.startLine - 1;
    const el0 = current.endLine - 1;
    const block: Block = {
        id: `prose:${sl0}:${el0}`,
        kind: inlineKindToTreeKind(current.blockKind, committedDraft),
        startLine: sl0,
        endLine: el0,
        depth: 0,
        text: current.initialContent ?? "",
        children: [],
    };
    const res = editorController.apply(
        { type: "replace-content", block, content: committedDraft },
        { text: fullTextRef.current }
    );
    if (res != null) {
        onCommit(res.text);
        return;
    }
    newFull = replaceSourceRange(fullTextRef.current, current.startLine, current.endLine, committedDraft);
}
```

**为什么复用而非新 intent**：list blur 提交与 prose blur 提交语义完全相同——「整体替换块内容
为 DOM 反序列化产物」。`replace-content` 的块坐标（startLine/endLine）由会话给出，天然支持
单项（start==end）与整组（end>start，嵌套列表）两种作用域。R1 的 turn-into 组级塌缩是
transformBlockType 路径的问题，blur 提交路径不涉及。

### 决策 2：修复重复 marker bug 的方式

**不用 wrapListMarker**：WYSIWYG 路径的 committedDraft（DOM 序列化产物）已含 marker，
replace-content 直接整体替换 → 源码 `- apple` 保持正确，改内容后 `- APRICOT`。
textarea 路径（非 wysiwyg）仍走原 else 的 wrapListMarker（draftText 是用户手输、无 marker，
需要包 marker 才能落盘为合法列表）——保持不动。

实现上：把 list 加入 wysiwyg-prose 分支即可；list 离开 else 分支后，else 分支只服务
textarea（非 wysiwyg）的 list/code 与其他块，wrapListMarker 逻辑原样保留。

### 决策 3：inlineKindToTreeKind 增加 list 分支

wysiwyg 的 blockKind "list" 不区分 bulleted/numbered/todo。`replace-content` 仅依赖坐标，
kind 只作数据模型语义。从 committedDraft 首行推断：

```ts
case "list": {
    const first = content.split("\n", 1)[0] ?? "";
    if (/\[[ xX]\]/.test(first)) return "todo";
    if (/^\s*\d{1,9}[.)]/.test(first)) return "numbered";
    return "bulleted";
}
```

### 决策 4：空内容 guard 与 P2-B2 一致

清空整个列表时 committedDraft 为空 → `committedDraft.length > 0` 为 false → 回落原
replaceSourceRange（空 segment = 删整行），与现状一致。

## 兼容与风险

- 风险 MEDIUM（与 P2-B2 相当）：list 是最常用块之一，涉及单项/整组/嵌套/任务列表。需覆盖
  边界测试。
- **行为变化点（有意为之）**：WYSIWYG list 提交从「重复 marker bug」变为「正确整体替换」。
  这是修复而非回归——textarea 路径零改动，WYSIWYG prose 路径零改动，只有 WYSIWYG list 的
  错误行为被纠正。测试需明确锁定新行为（`- APRICOT` 而非 `- - APRICOT`）。
- undo 复用：仍走 handleInlineEditCommit，P1 undo 栈不变。
- 双轨：textarea 路径、list 之外的块零改动；WYSIWYG list 单点收敛，可回滚。

## 明确的等价性验证用例（单测）

1. 单项列表项编辑：`- apple` → 用户改 APRICOT → 源码 `- APRICOT`（**无重复 marker**）。
2. 整组列表（2 项）：改第二项 → `- apple\n- PEAR`，替换后整组保持。
3. 有序列表：`1. first\n2. second` → 改内容后 marker 保持 `1.` / `2.`。
4. 任务列表：`- [ ] task` → 改内容后 `- [ ] newtask`。
5. 嵌套列表：父项含子 ul → 会话 endLine > startLine，整组替换不丢嵌套结构。
6. 空内容提交（清空列表）：回落 replaceSourceRange（删行），与现状一致。
7. 中段块：列表前有内容、列表后紧跟下一块 → 替换不吞换行/后续块。
8. textarea 路径回归：非 wysiwyg 的 list 提交仍走 wrapListMarker（需有既有测试覆盖或补）。

## 不做

- 不改 wysiwyg-editor.tsx（交互/序列化保留）。
- 不收敛 table / code / textarea。
- 不解决 R1（turn-into 组级）/ R2 / R3。
