# PRD: Session Note 编辑弹窗交互修复

## 背景（已核查）

会话 Note 编辑在代码里存在**两套实现**：

1. 独立模态 `frontend/app/modals/aisessionnotemodal.tsx`（列表行 / agent TUI 入口）
   ——`session-row.tsx:404`、`term-model.ts:1341` 经 `modalsModel.pushModal("AISessionNoteModal", ...)` 打开。
2. `session-detail.tsx` 内联弹窗（Detail 头栏 Note 入口，`~2122` 行 `<Modal>` 内 JSX）。

两套已漂移：modal 版有 `source` 徽标 + ID 展示 + error banner + `setError` 清理；inline 版吞掉
`model.updateNote` 失败原因、无 error message、保存后未回写 `noteDraft`。

本任务只修 inline 版的交互与视觉缺陷，并把可复用的「chips 可交互 + 关闭语义」规则定清楚；
**代码级共享化（抽 `<SessionNoteEditor>`）移交给 `10-25-aisessions-gen-entries`**，本任务末尾留一处待办标记。

截图标定的是 inline 版（`session-detail.tsx` 弹窗），问题清单见下。

## 目标（AC）

- AC1：Tag chips 与 textarea 正文**单一事实源**。chips 可点击 × 删除，正文 `#tag` 同步移除；正文增删 `#tag` 实时反映到 chips。不再出现「正文裸 `#tag` + chips 旧 tag」双份。
- AC2：chips 在 Note 编辑器里**视觉明确为 removable**，不再出现 hover/cursor 误导（去掉 disabled 态的 button 伪装）。
- AC3：副标题**优先显示 `summary.title`，回退到 `ID: shortId` 而非长路径**；补齐 `source` 徽标与 ID（与 modal 版对齐）。长标题截断时 tooltip 给全名。
- AC4：inline 版保存失败时**透传 error message**（复用 modal 版的红色 banner 写法），用户能看见原因。
- AC5：保存后**回写 `noteDraft`**（`setNoteDraft(updated.note)`），消除 unchanged 判定因 trim 造成的前后空格状态不一致。
- AC6：**关闭语义明确**：
  - Close 按钮 = 保存并关闭（saving 中禁用，保存完成后落库再关）。
  - backdrop 点击 / ESC = 有未保存内容时**标 dirty 并提示**（不静默落盘、不直接关）；确认丢弃才关。
  - 杜绝「点 Close 没反应」（saving 中 close 被静默丢弃）。
- AC7：三重保存路径（onBlur + 防抖 autosave + close）**不再竞争丢失**：close 保存与 autosave 落盘后统一回调关窗，saving 中任何关闭请求改为「保存完成后自动关」而非 return false 卡死。

## 非目标

- 不抽共享 `<SessionNoteEditor>` 组件（移交 `10-25-aisessions-gen-entries`）。
- 不改 `NoteAndTags` / `Summary` RPC、不动后端 schema、不动存储格式。
- 不改动 `aisessionnotemodal.tsx` 本身（除与 inline 版对齐的 chips removable 行为，若有需要单独 PR）。
- 不改 AI 生成建议的合并/应用逻辑（`noteAI` / `aiTags`），只修「应用后未落盘前 chips 误导」的视觉表述（AC1 已覆盖同步）。

## 约束

- 写入仍走现有 `model.updateNote` → `NoteAndTags` RPC；行为等价，不改请求结构。
- `summary.tags`（旧 tag）与正文 `#tag`、AI 建议 `aiTags` 三者合并规则不变（`mergeSessionTags`），仅改 UI 同步。
- 远端会话必须带 `connection`；本地为空串。编辑器已接收 `connection` prop。
- 不新增全局轮询 / 定时器（autosave 防抖沿用 `NoteAutoSaveDelayMs` 与 `shouldAutoSaveNote`）。

## 风险与数据安全边界

- **不影响现有任何数据**：本任务仅 frontend 交互/展示；唯一触碰磁盘的时机是用户主动点 chips ×（等价手动删 `#tag`）或点 Close 保存（等价在 textarea 敲字）。无批量改写、无迁移。
- `extractSessionTagsFromNote` 正则 `(^|\s)#([\p{L}\p{N}_-]+)` 对中文标点后 `#tag` 不识别、含 `.`/`/` 的 tag 被 normalize 丢弃——属数据源 bug，本任务**仅修 chips 与正文的同步**，正则放宽列入后续（不在 AC，标注 TODO）。
