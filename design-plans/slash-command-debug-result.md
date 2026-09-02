# 斜杠命令选择后无反应 — 根因分析

## 执行流程梳理

```
用户输入 "/" → detectInlineTrigger() 检测到 slash trigger
→ setSlashState({query, triggerStart}) → SlashPalette 渲染
→ 用户点击/Enter 选择命令 → handleSlashPick(cmd)
→ execSlashCommand(fullText, invocation, cmd)
→ handleInlineEditCommit(result.text) → inlineEdit.dismiss()
→ refocusCommittedBlock(result.text, result.focusLine, result.caret)
```

## 最可能的根因（按概率排序）

### 根因 1：`execSlashCommand` 返回 null（最高概率）

**位置**：`frontend/app/element/block-editor/exec.ts:96-97`

```typescript
if (inFence || kind === "code") {
    return null; // commands never fire with code context
}
```

`execSlashCommand` 在以下情况返回 null：
- 被编辑的块位于 fenced code block 内部（`inFence === true`）
- `detectBlockKind(baseLines, line)` 返回 `"code"`

**关键路径**：`execSlashCommand` 先用 `composeSessionText()` 组合出 baseText，然后在 baseText 上调用 `detectBlockKind`。如果组合后的 baseText 让 `detectBlockKind` 误判为 "code"，命令就会静默失败。

**具体触发场景**：
- 用户在包含反引号的段落中触发斜杠命令（如 "使用 `code`"）
- `composeSessionText` 替换 draft 后，剩余文本碰巧包含未闭合的 fence 标记
- `computeFenceSpans` 将该行判定为在 fence 内部

**修复建议**：在 `execSlashCommand` 返回 null 时添加 console.warn 日志，确认是否是此路径。

### 根因 2：`handleSlashPick` 中 session/slashState 为 null

**位置**：`frontend/app/element/markdown.tsx:3719-3721`

```typescript
const session = inlineEdit.editSession;
if (session == null || slashState == null) {
    return; // 静默返回，无日志
}
```

**触发场景**：
- SlashPalette 的 `onMouseDown={stopMouse}` 理论上阻止了 textarea blur
- 但如果用户在触摸板上快速点击，可能触发 blur → commit → session 关闭 → handleSlashPick 拿到 null session
- 或者 `trackEditorTriggers` 在某些边界条件下清除了 `slashState`

**修复建议**：在此 early return 前添加 console.warn。

### 根因 3：`handleInlineEditCommit` 的 no-op 路径

**位置**：`frontend/app/element/markdown-inline-edit.tsx:636-640`

```typescript
if (draftText === current.initialContent && current.insertMode == null) {
    // No-op commit: nothing to write.
    return;
}
```

**注意**：这个路径在 `handleSlashPick` 中**不太可能**被触发，因为 `handleSlashPick` 直接调用 `handleInlineEditCommit(result.text)` 而不是通过 `commit()`。`handleInlineEditCommit` 的实现（markdown.tsx:1858）直接调用 `onInlineEditCommit(nextText)`，没有 no-op 检查。

### 根因 4：`filterSlashCommands` 返回空列表

**位置**：`frontend/app/element/block-editor/registry.ts:148-168`

如果 `slashState.query` 与所有命令的 label/id/keywords 都不匹配，`slashItems` 为空数组，SlashPalette 显示 "No matching commands"，用户无法选择任何命令。

**但这不是"选择后无反应"的问题** — 这是"看不到可选命令"的问题。

### 根因 5：`refocusCommittedBlock` 失败

**位置**：`frontend/app/element/markdown.tsx:3664-3673`

```typescript
const refocusCommittedBlock = useCallback(
    (nextText, focusLine, caret) => {
        const kind = detectBlockKind(lines, focusLine);
        if (kind == null) return; // 静默返回
        focusEditedLine(focusLine, ...);
    }, ...);
```

如果 `detectBlockKind` 返回 null（空行或无效行），focus 会静默失败。但此时文本已经提交，用户应该能看到内容变化（只是没有重新进入编辑模式）。

## 调试方案

### 方案 A：添加关键路径日志（推荐先做）

在以下位置添加 `console.warn`：

1. **`exec.ts:96`** — 在 `return null` 前：
```typescript
if (inFence || kind === "code") {
    console.warn("[slash-debug] execSlashCommand: blocked by code context", { inFence, kind, line, baseText: baseText.slice(0, 200) });
    return null;
}
```

2. **`markdown.tsx:3719`** — 在 early return 前：
```typescript
if (session == null || slashState == null) {
    console.warn("[slash-debug] handleSlashPick: null session/slashState", { session: !!session, slashState: !!slashState });
    return;
}
```

3. **`markdown.tsx:3733`** — 在 result null 检查后：
```typescript
if (result == null) {
    console.warn("[slash-debug] handleSlashPick: execSlashCommand returned null", { cmd: cmd.id, text: text.slice(0, 100) });
    return;
}
```

4. **`markdown.tsx:3755`** — 在 handleInlineEditCommit 调用后：
```typescript
console.warn("[slash-debug] handleSlashPick: committed", { cmd: cmd.id, newTextLength: result.text.length, focusLine: result.focusLine });
```

### 方案 B：CDP 实时排查

1. 打开一个 markdown 文件进入编辑模式
2. 在 DevTools Console 中注入：
```javascript
// 监控 execSlashCommand
const origExec = window.__execSlashCommand;
// (需要先在代码中暴露到 window)
```

3. 或者直接在 `exec.ts` 中添加 `console.warn` 后重新构建

## 修复建议

### 优先修复：添加调试日志

在上述 4 个位置添加 `console.warn`，然后让用户复现问题，根据日志确定具体是哪条路径导致的静默失败。

### 可能的代码修复

如果是**根因 1**（code context 误判）：
- 在 `execSlashCommand` 中，当 `kind === "code"` 但原始 session 的 blockKind 不是 "code" 时，跳过 code 检查
- 或者在 `composeSessionText` 后重新检测 kind 时使用更宽松的逻辑

如果是**根因 2**（session 提前关闭）：
- 在 `SlashPalette` 的 `onMouseDown` 中添加 `e.stopPropagation()` 防止事件冒泡
- 或者在 `handleSlashPick` 中检查 session 是否仍然有效

## 影响范围

- 所有 slash 命令（heading、list、code block、table、divider、image、wiki link、emoji）
- 所有 block kind（text、heading、list、quote、code、table）
- 仅影响 inline editing 模式（双击/单击段落进入编辑后触发 /）

## 风险评估

- 调试日志添加：低风险，仅添加 console.warn
- 代码修复：需要根据实际日志确定具体路径后再做
