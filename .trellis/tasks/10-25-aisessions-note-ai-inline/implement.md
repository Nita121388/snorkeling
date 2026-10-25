# Implement: 编辑器内 AI 生成 Note/Tags

## 0. 前置

- 无后端依赖（复用 `GenerateMetadata`）。
- 与 `gen-entries` 无代码依赖（不同文件），可并行。

## 1. 共享控件

- [ ] 新建 `frontend/app/view/aisessions/note-ai-controls.tsx`：
      `useNoteAIGenerate` + `NoteAIButton` + `NoteAISuggestion`。
- [ ] 自动重试 1.5s/4s（共 3 次尝试）；配置错误不重试。
- [ ] 建议条 Apply/Regenerate/Dismiss；错误态 Retry/Open settings。

## 2. 接入三处

- [ ] `session-row.tsx` 行内编辑器：按钮 + 建议条；空草稿自动 Apply。
- [ ] `aisessionnotemodal.tsx`：按钮 + 建议条；`pendingTags` 并入保存。
- [ ] `session-detail.tsx` Note 弹窗：按钮 + 建议条；`pendingTags` 并入 `saveNote`。

## 3. 细节

- [ ] 生成期间不 disabled textarea、不抢焦点。
- [ ] Apply 后同步 `latestDraftRef`（row）/ `latestNoteDraftRef`（detail）。
- [ ] `connection` 透传。

## 4. 验证

```powershell
npx tsc --noEmit
npx vitest run frontend/app/view/aisessions
```

- [ ] 三处各手工验证一次：空草稿直填、非空走 Apply、失败重试、配置缺失引导。

## 5. 收尾

- [ ] eslint 改动文件。
- [ ] commit（前端单条）。

## Review gate

- [ ] 不新增落库路径（仍走三处原有保存）。
- [ ] 生成期间编辑器可用。
- [ ] 配置错误不重试。
