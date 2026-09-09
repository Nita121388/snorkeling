# Slash 命令中集成 Emoji 选择功能设计方案

## 背景

当前项目中：
- `/` 命令在行首触发，用于块级转换（标题、列表、代码块等）
- `:` 命令在行内边界后触发，用于 emoji 选择
- 用户希望在 `/` 命令中也能选择 emoji，以便在笔记中插入 emoji

## 设计目标

在 `/` 命令列表中添加一个 "Emoji" 命令，用户选择后可以打开 emoji 选择器，选择 emoji 后将其插入到当前光标位置。

## 实现方案

### 方案 1：添加 Emoji 命令到 Slash 注册表（推荐）

#### 1. 修改 `builtinSlashCommands()` 函数
在 `frontend/app/element/block-editor/commands/slash.ts` 中添加：

```typescript
const emojiCommand: SlashCommandSpec = {
    id: "emoji",
    label: "Emoji",
    hint: "😀",
    keywords: ["emoji", "表情", "emoticon"],
    group: "insert",
    run: (ctx) => {
        // 返回特殊标记，表示需要打开 emoji 选择器
        return { 
            text: ctx.text, 
            caret: ctx.caret, 
            focusLine: ctx.line,
            openEmojiPicker: true  // 特殊标记
        };
    },
};
```

#### 2. 修改 SlashCommandSpec 类型
在 `frontend/app/element/block-editor/registry.ts` 中扩展类型：

```typescript
export interface SlashCommandRunResult {
    text: string;
    caret?: number;
    focusLine?: number;
    openEmojiPicker?: boolean;  // 新增：表示需要打开 emoji 选择器
}
```

#### 3. 修改 handleSlashPick 逻辑
在 `frontend/app/element/markdown.tsx` 中修改 `handleSlashPick`：

```typescript
const handleSlashPick = useCallback(
    (cmd: SlashCommandSpec) => {
        const session = inlineEdit.editSession;
        if (session == null || slashState == null) {
            return;
        }
        const caret = inlineEdit.textareaRef.current?.selectionStart ?? inlineEdit.draftText.length;
        const result = execSlashCommand(
            text,
            { session, draftText: inlineEdit.draftText, triggerStart: slashState.triggerStart, caret },
            cmd
        );
        setSlashState(null);
        
        if (result == null) {
            return;
        }
        
        // 如果命令要求打开 emoji 选择器
        if (result.openEmojiPicker) {
            // 设置状态，打开 emoji 选择器
            setSlashEmojiPickerOpen(true);
            return;
        }
        
        handleInlineEditCommit(
            result.text,
            session.blockKind === "list" ? { renumberOrderedListFromLine: session.startLine } : undefined
        );
        inlineEdit.dismiss();
        if (result.focusLine != null) {
            refocusCommittedBlock(result.text, result.focusLine, result.caret);
        }
    },
    [inlineEdit, slashState, text, handleInlineEditCommit, refocusCommittedBlock]
);
```

#### 4. 添加新的状态管理
在 markdown.tsx 中添加：

```typescript
const [slashEmojiPickerOpen, setSlashEmojiPickerOpen] = useState(false);
const [slashEmojiPickerAnchor, setSlashEmojiPickerAnchor] = useState<{ top: number; left: number } | null>(null);
const [slashEmojiQuery, setSlashEmojiQuery] = useState("");
const [slashEmojiActive, setSlashEmojiActive] = useState(0);
```

#### 5. 处理 emoji 选择
添加处理函数：

```typescript
const handleSlashEmojiPick = useCallback(
    (entry: EmojiEntry) => {
        const ta = inlineEdit.textareaRef.current;
        if (ta == null) {
            return;
        }
        
        // 在光标位置插入 emoji
        const draft = inlineEdit.draftText;
        const cursorPos = ta.selectionStart;
        const next = draft.slice(0, cursorPos) + entry.char + draft.slice(cursorPos);
        const nextCaret = cursorPos + entry.char.length;
        
        inlineEdit.setDraftText(next);
        recordRecentEmoji(entry.char);
        setSlashEmojiPickerOpen(false);
        
        requestAnimationFrame(() => {
            const el = inlineEdit.textareaRef.current;
            if (el != null) {
                el.focus({ preventScroll: true });
                el.setSelectionRange(nextCaret, nextCaret);
            }
        });
    },
    [inlineEdit]
);
```

#### 6. 渲染 emoji 选择器
在 markdown.tsx 的 JSX 中添加：

```typescript
{slashEmojiPickerOpen && slashEmojiPickerAnchor != null && inlineEdit.editSession != null && (
    <EmojiPicker
        anchor={slashEmojiPickerAnchor}
        placement="bottom"
        mode="inline"
        catalog={emojiCatalog}
        query={slashEmojiQuery}
        onQueryChange={setSlashEmojiQuery}
        activeIndex={slashEmojiActive}
        onActiveChange={setSlashEmojiActive}
        onPick={handleSlashEmojiPick}
        onClose={() => setSlashEmojiPickerOpen(false)}
    />
)}
```

### 方案 2：使用现有的冒号触发器（备选）

如果不想修改 slash 命令的执行逻辑，可以：

1. 在 slash 命令列表中添加一个提示，告诉用户使用 `:` 触发 emoji 选择
2. 或者在 slash 命令执行时，自动在光标位置插入 `:` 并触发 emoji 选择器

## 优势与劣势

### 方案 1 优势
- 用户体验一致，所有命令都在 `/` 命令中
- 支持键盘导航和搜索
- 符合用户期望

### 方案 1 劣势
- 需要修改 slash 命令的执行逻辑
- 需要添加新的状态管理
- 增加了一定的复杂性

### 方案 2 优势
- 实现简单，不需要修改 slash 命令逻辑
- 复用现有的 `:` 触发器

### 方案 2 劣势
- 用户需要记住两个不同的触发方式
- 不符合用户期望

## 推荐方案

**推荐方案 1**，因为它提供了更好的用户体验，并且符合用户明确的需求。

## 实现步骤

1. 修改 `builtinSlashCommands()` 添加 emoji 命令
2. 扩展 `SlashCommandRunResult` 类型
3. 修改 `handleSlashPick` 处理特殊命令
4. 添加状态管理
5. 实现 emoji 选择器集成
6. 测试和调试

## 测试用例

1. 在行首输入 `/`，验证 emoji 命令出现在列表中
2. 选择 emoji 命令，验证 emoji 选择器打开
3. 在 emoji 选择器中搜索并选择 emoji，验证 emoji 被插入到正确位置
4. 验证键盘导航和搜索功能正常工作
5. 验证 emoji 插入后光标位置正确
6. 验证最近使用的 emoji 功能正常工作
