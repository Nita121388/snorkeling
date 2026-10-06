# P2-B3 Implement Plan

## 状态：实施完成 ✓（待 check 复验 → 已 PASS）

## 实施记录（2026-10-06）

- Step 1：`inlineKindToTreeKind` 增加 list 分支：从 committedDraft 首行推断 kind ——
  marker 后紧跟 `[ xX]` → todo（正则锚定 marker 位置，与 ListItemLineRe 语义一致，避免
  `- see [x] note` 误判）；`^\s*\d{1,9}[.)]` → numbered；否则 bulleted。
- Step 2：commit() 的 wysiwyg 分支条件加入 `current.blockKind === "list"`（p/h/quote/blank/list），
  复用 P2-B2 的 replace-content intent + 共享单例；else 分支 wrapListMarker 保留（现只服务
  textarea 路径）。修复重复 marker bug：WYSIWYG list 的 committedDraft 已含每行 marker，整体
  替换即正确（`- APRICOT` 而非 `- - APRICOT`）。
- Step 3：markdown-inline-edit.test.ts 新增 9 个用例（单项/整组/有序/任务/嵌套/空内容/
  textarea 回归/中段块/todo 边界正则），用真实 editorController + inlineKindToTreeKind +
  replaceSourceRange 复刻 commit 分支断言。实测 39 文件 / 526 测试全绿（517 基线 + 9）；
  tsc 68 基线不变零新增。
- trellis-check 复验：6 条验收标准全部 PASS；非阻塞建议（正则锚定）已落实并补边界测试。

## 目标

把列表块（bulleted/numbered/todo）WYSIWYG 编辑提交从「裸行号 replaceSourceRange + wrapListMarker
重复包 marker」收敛到块模型编辑控制器（复用 P2-B2 的 `replace-content` intent），同时**修复
现状重复 marker bug**。内容来源仍是 DOM 反序列化（serializeListDomToMarkdown，wysiwyg-editor
本体不改），收敛的是提交通道/定位 → 统一到块模型 + undo 栈模式。

## Step 0 前置确认（已完成勘察）

- `replace-content` intent 与 `editorController` 单例已就绪（P2-B2 交付）。
- `inlineKindToTreeKind` 已有（P2-B2 交付），需增加 list 分支。
- wysiwyg-prose 分支条件在 markdown-inline-edit.tsx commit()（P2-B2 加入，约 920-960 行），
  当前覆盖 p/h/quote/blank；把 list 加入条件即可，else 分支的 wrapListMarker 自动只服务
  textarea（非 wysiwyg）路径。

## Step 1 inlineKindToTreeKind 增加 list 分支

`markdown-inline-edit.tsx` 的 `inlineKindToTreeKind` 增加：

```ts
case "list": {
    const first = content.split("\n", 1)[0] ?? "";
    if (/\[[ xX]\]/.test(first)) return "todo";
    if (/^\s*\d{1,9}[.)]/.test(first)) return "numbered";
    return "bulleted";
}
```

## Step 2 commit() 的 wysiwyg 分支加入 list

把 P2-B2 分支条件从 `p/h/quote/blank` 扩展为 `p/h/quote/blank/list`（加 `current.blockKind ===
"list"`）。逻辑不变：构造 0-based Block → `editorController.apply({type:"replace-content",
block, content: committedDraft})` → onCommit(res.text) → handleInlineEditCommit（进 undo 栈）；
res==null 时 fallthrough 原 replaceSourceRange。

**修复 bug 的关键**：WYSIWYG list 的 committedDraft（DOM 序列化产物）已含 marker，直接整体
替换即正确（`- APRICOT` 而非 `- - APRICOT`）。else 分支的 wrapListMarker 现在只服务 textarea
路径（draftText 为用户手输无 marker，需要包 marker），零改动。

## Step 3 测试

1. `editor-controller.test.ts`：现有 replace-content 用例已覆盖坐标语义（单行/中段/多行/
   CRLF/空内容），list 复用同一 intent，无需新增控制器级用例（可选加一条整组多行替换断言）。
2. **新增列表提交行为测试**（建议放 markdown-inline-edit.test.ts 或新建 list 提交测试）：
   - 单项：`- apple` 改 APRICOT → 源码 `- APRICOT`（锁定修复，防回归到 `- - APRICOT`）。
   - 整组 2 项：改第二项 → `- apple\n- PEAR`。
   - 有序：`1. first\n2. second` 保持 marker。
   - 任务列表：`- [ ] task` → `- [ ] newtask`。
   - 嵌套：父项含子列表，endLine > startLine 整组替换不丢嵌套。
   - 空内容（清空列表）→ 回落 replaceSourceRange 删行。
   - textarea 路径：非 wysiwyg list 提交仍走 wrapListMarker（若没有现成测试则补一条，
     用 replaceSourceRange + wrapListMarker 复刻断言）。
3. 确认 wysiwyg list 提交走 handleInlineEditCommit（undo 栈覆盖不变）。

## 校验门

- [ ] 既有 517 element 测试全绿（含 list 相关）
- [ ] tsc 无新增错误
- [ ] 修复验证：WYSIWYG list 编辑不再重复 marker（`- APRICOT` 而非 `- - APRICOT`）
- [ ] 可回滚：textarea list 零改动（wrapListMarker 保留）；wysiwyg prose 零改动；
      只有 WYSIWYG list 单点收敛 + bug 修复

## 提交

- 单 commit。提交前 `pwd && git branch --show-current`。
- 关联 task 10-06-p2-b3-converge-list。
