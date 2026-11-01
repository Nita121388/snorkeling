# Design — Agent 悬浮卡 Note 行内编辑 + 弹窗 + 整卡放大

## 架构决策
1. **复用 AISessionNoteModal**（不新建重复 Note 弹窗）——通过 `modalsModel.pushModal("AISessionNoteModal", { sessionId, connection })`，与 session-row 完全一致。
2. **新建 AgentCardModal**（整卡放大）——独立 App 级弹窗，内容与 AgentHoverCard 一致但常驻可编辑。
3. **共享内容组件**：从 `AgentHoverCard` 抽出纯内容（不含 hover 定位）为可复用组件，`AgentHoverCard` 与 `AgentCardModal` 共用，避免漂移。

## 数据流
- `property-list.tsx`：
  - 新增 prop `onOpenNoteDialog?: () => void`——note 行弹窗 icon 触发。
  - note 行渲染时，若 `onOpenNoteDialog` 存在，值区右侧加 `fa-up-right-and-down-left-from-center` icon（hover 显示，`opacity-0 group-hover:opacity-100`）。
  - 点击 note 行 → `onEditNote()`（保持行内编辑语义，就地在 note 行展开 textarea）。
- `session-note-section.tsx`：
  - 新增 `openNoteDialog` 回调：`modalsModel.pushModal("AISessionNoteModal", { sessionId: sessionKey, connection })`。
  - 传给 `PropertyList.onOpenNoteDialog`。
  - 新增 prop `onOpenCardDialog?: () => void`——卡片头部放大 icon 触发。
- `agent-hover-card.tsx`：
  - 卡片头部（provider 行右侧）加放大 icon，hover 显示，点击 → `modalsModel.pushModal("AgentCardModal", { blockId, blockData })`。
  - 抽出内容为共享组件（见下）。
- 新文件 `frontend/app/modals/agentcardmodal.tsx`：
  - `AgentCardModal({ blockId, blockData })`——渲染共享内容，`canEditProperties={true}`，`Modal className="w-[min(680px,calc(100vw-32px))]"`。
  - 注册到 `modalregistry.tsx`。

## 共享内容抽取策略
`AgentHoverCard` 当前是 memo 组件，包含：resolveBlockSessionId / useSessionNoteState / agentStatus / runtimeEntry / personas / agentIcon / copy 逻辑 / 渲染 JSX。

抽取方式（最小侵入）：
- 保留 `AgentHoverCard` 作为**外壳**（负责 hover 定位、卡片尺寸、复制 session id 底行）。
- 抽出 `AgentCardContent({ blockId, blockData, embedded?: boolean })`——包含 model/status/note/tags/属性 的核心渲染。
- `AgentHoverCard` 渲染 `<AgentCardContent>`；`AgentCardModal` 渲染 `<AgentCardContent embedded>`（弹窗内，放大尺寸，全可编辑）。

## 交互汇总
| 操作 | 行为 |
|---|---|
| 点击 Note 行 | 行内 textarea（就地） |
| Note 行旁弹窗 icon（hover 显示） | AISessionNoteModal |
| 卡片头部放大 icon（hover 显示） | AgentCardModal（整卡放大编辑） |
