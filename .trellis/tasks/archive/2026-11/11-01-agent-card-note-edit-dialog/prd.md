# PRD — Agent 悬浮卡 Note 行内编辑 + 弹窗编辑 + 整卡放大弹窗

## 需求来源
用户实际使用 agent 悬浮卡时反馈：
1. 点击 Note 行应**直接在行内输入框编辑**（不跳转/不替换整卡）。
2. 提供**弹窗编辑 icon**（类似 aisessions 列表行的 `fa-up-right-and-down-left-from-center`），点击打开放大 Note 编辑弹窗。
3. **整张 agent 卡也能弹窗放大编辑**——把模型/状态/Note/Tags/属性整体放大成可编辑弹窗。

## 现状（已确认）
- `property-list.tsx`：点击 note 行 → `onEditNote()` → `SessionNoteSection` 里 `setIsEditing(true)` → 行内渲染 `InfoCardInput`（textarea rows=4）。**已是行内编辑**，但会替换整卡 PropertyList 显示，无放大入口。
- `session-row.tsx`：aisessions 列表行 note 内容旁有 `fa-up-right-and-down-left-from-center` icon（hover 行显示），点击 `openNoteDialog()` → `modalsModel.pushModal("AISessionNoteModal", { sessionId, connection })`。
- `AISessionNoteModal`（`frontend/app/modals/aisessionnotemodal.tsx`）：App 级弹窗，680px 宽、240px 高 textarea + AI 生成 + tags + 自动保存。
- `modalregistry.tsx`：注册表模式，`AISessionNoteModal` 已注册。
- `AgentHoverCard`（`frontend/app/view/term/agent-hover-card.tsx`）：悬浮卡，含 model/status/note/tags/session-id，`canEditProperties` 已放开为 true。
- 三个消费方（block.tsx header hover / tab-more-menu / TermAgentSessionRail）都经 `InfoCardPortal` 渲染，焦点保活机制生效（编辑不因 hover 离开打断）。

## 验收标准
1. **点击 Note 行** → Note 行值区域就地变成 textarea（其余属性行不动），blur/Escape 保存。
2. **Note 行右侧弹窗 icon**（`fa-up-right-and-down-left-from-center`，hover 卡片显示）→ 打开 `AISessionNoteModal`。
3. **卡片头部放大 icon**（`fa-up-right-and-down-left-from-center`，hover 显示）→ 打开 `AgentCardModal`（整卡放大编辑，全可编辑）。
4. `AgentCardModal` 内容结构与 `AgentHoverCard` 一致，常驻弹窗（无 hover 消失），可编辑所有属性。
5. 所有改动在 worktree `feat/agent-card-note-edit-dialog`，main 不被直接改动。
6. tsc 无新增错误；eslint 通过；相关测试全绿。

## 约束
- 复用现有 `AISessionNoteModal`（不新建重复 Note 弹窗）。
- 复用 `modalsModel.pushModal` / `modalregistry` 注册机制。
- 数据安全：不动属性数据层（sqlite-only 保持）。
- 用户工作区未提交文件（package-lock / metaconsts / settings）不碰。
