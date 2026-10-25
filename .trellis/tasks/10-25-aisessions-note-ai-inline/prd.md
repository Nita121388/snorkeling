# PRD: 编辑器内 AI 生成 Note/Tags（列表行内编辑器 + 两个 Note 弹窗）

## 背景（已核查）

三处真正编辑 note/tags 的 UI 都没有 AI 能力，各自维护草稿与保存：

| 位置 | 文件 | 保存路径 |
|---|---|---|
| 列表行内展开编辑 | `frontend/app/view/aisessions/session-row.tsx` L620 附近 | `onNoteSave(note, tags)` |
| 列表行的 Note 弹窗 | `frontend/app/modals/aisessionnotemodal.tsx` | `service.NoteAndTags` |
| Detail 头栏 `··· → Edit note & tags` 弹窗 | `frontend/app/view/aisessions/session-detail.tsx:1706` | `model.updateNote` |

AI 提案能力已有：`AISessionsService.GenerateMetadata({id, connection, aiMode})` →
`{summary, suggestion:{note, tags}}`（`pkg/service/aisessionsservice/aisessionsservice.go:953`）。
配置可用性判断：`resolveMetadataAIMode()`。

## 目标

1. 抽出共享 `note-ai-controls`（hook + 按钮 + 建议条），三处复用。
2. 点击生成 → 静默调用 `GenerateMetadata`，自动重试 2 次（1.5s / 4s），**不阻塞编辑器输入**。
3. 草稿为空 → 生成成功后直接填入 `noteDraft` + `tagDraft`；草稿非空 → 显示建议条，点 Apply 才写入。
4. 失败终态给 `Retry`；模型未配置直接引导（不重试）。
5. 不改变三处编辑器原有的保存 / 自动保存语义。

## 非目标

- 不在编辑器里调用 `AutoGenerate`（那是静默落库，会覆盖正在编辑的内容）。
- 不做生成历史 / 多版本建议。
- 不改 note/tags 的数据模型。
- 不改 InfoCard（`session-note-section.tsx`）的旧提案路径；它由 `gen-entries` 改为 AutoGenerate。

## 约束

- 三处都带 `connection`。
- 自动重试只对网络/模型瞬时错误；配置类错误（无模型/telemetry）不重试。
- 生成期间 textarea 保持可编辑（不 disabled、不抢焦点）。
- Apply 后标 `dirty`，后续由各编辑器原本的自动保存/保存按钮落盘。

## 用户故事

1. 我在列表行内编辑器点 wand，光标不丢，几秒后 note+tags 被填好，我继续改两个字再保存。
2. 我已经写了一段 note，点生成，出来一个建议条，我确认没问题才点 Apply 覆盖。
3. 模型没配时，点生成直接提示去设置，不会转圈。

## 验收标准

- [ ] 三处编辑器都能看到 wand 按钮；点击后 textarea 不 disabled、不失去焦点。
- [ ] 空草稿：生成成功后 `noteDraft/tagDraft` 被填入，`dirty=true`。
- [ ] 非空草稿：出现建议条（note 预览 + tags + Apply/Regenerate/Dismiss），Apply 才写入。
- [ ] 自动重试 2 次；终态失败显示错误 + Retry；配置错误不重试。
- [ ] Apply 后 note/tags 正确落到对应保存路径（人工验证三处各一次）。
- [ ] `npx tsc --noEmit` 无新增错误；新增组件有单测。
