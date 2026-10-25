# Design: 编辑器内 AI 生成 Note/Tags

## 1. `note-ai-controls.tsx`（新）

```tsx
export type NoteAIStatus = "idle" | "loading" | "ready" | "error";

export function useNoteAIGenerate(sessionId: string, connection: string) {
    // 内部：AISessionsServiceType 实例（useMemo）
    // 输入上下文：existingNote / existingTags（由调用方在 generate() 时传入）
    const [status, setStatus] = useState<NoteAIStatus>("idle");
    const [error, setError] = useState("");
    const [suggestion, setSuggestion] = useState<{ note: string; tags: string[] } | null>(null);

    const generate = useCallback(async (existingNote: string, existingTags: string[]) => {
        const cfg = resolveMetadataAIMode();
        if (!cfg.available) { setError(cfg.reason); setStatus("error"); return; } // 不重试
        setStatus("loading"); setError("");
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const res = await service.GenerateMetadata({
                    id: sessionId, connection: connection || undefined, aiMode: cfg.mode,
                });
                setSuggestion({ note: res.suggestion.note, tags: res.suggestion.tags });
                setStatus("ready"); return;
            } catch (e) {
                if (attempt >= 2) { setError(String(e)); setStatus("error"); return; }
                await delay(attempt === 0 ? 1500 : 4000);
            }
        }
    }, [sessionId, connection, service]);

    return { status, error, suggestion, generate, dismiss: () => { setStatus("idle"); setSuggestion(null); } };
}
```

> `GenerateMetadata` 后端目前只接受 `{id, connection, aiMode}`，已有的 note/tags 由后端 `Load` 读取，
> 不需要前端传；`existingNote/existingTags` 仅用于本地"空/非空"决策，不参与 RPC。

组件：

```tsx
<NoteAIButton status onGenerate />             // wand / spinner / warning
<NoteAISuggestion suggestion status error onApply onRegenerate onDismiss onOpenSettings />
```

- 建议条：note 预览（`line-clamp-2`）+ tag chips + `Apply / Regenerate / Dismiss`。
- 错误态：`Error` 文案 + `Retry`（仅非配置错误）+ `Open AI settings`（配置错误）。
- 样式复用编辑器现有的 `text-[10px]/text-xs` 与 `border-border` token。

## 2. 三处接入

### 2.1 `session-row.tsx`（行内编辑器）

在 `Clear` 那一排前插入：

```tsx
<NoteAIButton .../>
{ai.suggestion && <NoteAISuggestion onApply={() => {
    setNoteDraft(ai.suggestion.note);
    setTagDraft(ai.suggestion.tags);
    latestDraftRef.current = ai.suggestion.note;
    setNoteSaveStatus("idle");
}} />}
```

空草稿自动 Apply：`generate()` 返回后，若 `noteDraft.trim()==="" && session.tags.length===0`，
直接执行与上面相同的写入（用 `useEffect` 监听 `status==="ready"`）。

### 2.2 `aisessionnotemodal.tsx`

- 该弹窗 tags 来自 `summary.tags` + note 内 `#tag` 解析；`Apply` 时把 suggestion 的 note 写入
  `noteDraft`，tags 通过 `mergeSessionTags(summary.tags ?? [], suggestion.tags)` 暂存到一个
  `aiTagDraft` state，保存时 `mergeSessionTags(parsed.tags, aiTagDraft)`。
- 工具条放在 `Clear` 旁边。

### 2.3 `session-detail.tsx`（Note 弹窗 L1706）

- `Apply` 写 `noteDraft`；tags 经既有 `mergeSessionTags(summary.tags, parsed.tags)` 在 `saveNote` 时
  已经处理——把 suggestion.tags 写成一个 `pendingTags` state，`saveNote` 里并入。
- 工具条放在 `Clear` 旁边。

## 3. 焦点与自动保存

- 生成期间不 `disabled` textarea；只转按钮图标。
- 自动 Apply（空草稿）后，`dirty` 由 `setNoteDraft` 触发；自动保存定时器会按原逻辑落盘。
  **注意**：`session-row` 的自动保存 effect 依赖 `noteUnchanged`，Apply 后必须让 `noteDraft` state
  更新（React 批处理下 useEffect 会重新计算），无需额外标记。
- 非空草稿的 Apply 由用户显式点击，不会误触发。

## 4. 测试

- `note-ai-controls.test.tsx`：空/非空分支、自动重试 2 次、配置错误不重试、Apply 调用。
- 三处接入的人工验证（每处一次）。
