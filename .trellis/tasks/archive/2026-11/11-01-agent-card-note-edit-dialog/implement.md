# Implement — Agent 悬浮卡 Note 行内编辑 + 弹窗 + 整卡放大

## 执行步骤（顺序）
1. **property-list.tsx**：
   - 新增 prop `onOpenNoteDialog?: () => void`。
   - note 行值区右侧加弹窗 icon（`fa-up-right-and-down-left-from-center`，hover 显示）→ `onOpenNoteDialog`。
   - note 行点击 → `onEditNote()`（保持行内编辑）。
2. **session-note-section.tsx**：
   - 新增 `openNoteDialog` 回调（`pushModal("AISessionNoteModal", ...)`）。
   - 传给 `PropertyList.onOpenNoteDialog`。
   - 新增 prop `onOpenCardDialog?: () => void`（卡片头部放大 icon 触发）。
3. **agent-hover-card.tsx**：
   - 抽出共享内容组件 `AgentCardContent`（model/status/note/tags/属性核心渲染）。
   - `AgentHoverCard` 外壳保留（hover 定位 + 复制底行），渲染 `<AgentCardContent>`。
   - 卡片头部加放大 icon → `pushModal("AgentCardModal", { blockId, blockData })`。
4. **新建 `frontend/app/modals/agentcardmodal.tsx`**：
   - `AgentCardModal` 渲染 `<AgentCardContent embedded>`，`canEditProperties={true}`，`Modal` 放大尺寸。
5. **modalregistry.tsx**：注册 `AgentCardModal`。

## 验证命令
- `tsc -p tsconfig.json --noEmit`（无新增错误，基线 main=78）
- `eslint frontend/app/view/term/agent-hover-card.tsx frontend/app/element/info-card/session-note-section.tsx frontend/app/view/aisessions/property/property-list.tsx frontend/app/modals/agentcardmodal.tsx`
- `vitest run frontend/app/block/block-info-card.test.tsx frontend/app/tab/tab-more-menu.dom.test.tsx`（block-info-card 应全过；tab-more 既有 localStorage 失败除外）

## 审查门
- 每步改动后跑 tsc 确认无新增错误。
- 完成所有步骤后跑完整验证。
- 提交到 `feat/agent-card-note-edit-dialog`，推送，出 PR 到 main（用户确认后）。

## 回滚点
- 每步一个小 commit，可单独 revert。
- worktree 分支隔离，main 不被触碰。
