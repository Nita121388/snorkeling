# Block InfoCard 覆盖 Session Detail / Chat block，并修复 agent block 的 note/tags 不展示

## Background

Block 级 InfoCard 的接入点已经统一在 `frontend/app/block/block-info-card.tsx` 的
`BlockInfoCard()` 分派器：Note → PreviewInfoCard，Preview → PreviewInfoCard，Agent → AgentHoverCard。
该分派器被 4 个 surface 复用（inline tab、block frame header、sidebar、Tab 信息卡的分类），
所以「新增一类卡片」只需在分派器加分支，壳子代码不用动。

现状缺口：

1. **Session Detail block 没有任何卡片**。它的 meta 是
   `{ view: "aisessions", "aisessions:sessionid": <id>, "frame:title": "Session Details" }`
   （`frontend/app/view/aisessions/session-detail-block.ts` 的 `makeSessionDetailBlockDef`）。
   `BlockInfoCard` 的三个分支都不命中它，`blockframe-header.tsx:560` 的
   `isAgentBlock = isTerminalBlock && isAgentTerminalMeta(...)` 更是直接把它排除（`view !== "term"`）。
2. **GUI Chat（Agent block，view=aisessions）同样没有卡片**，是整套 InfoCard 的覆盖空白区。
3. **在全局 aisession 视图里编辑的 note/tags 在 agent block 的悬浮卡上不展示**。后端链路是通的
   （`Manager.NoteAndTags` 写 sqlite 后 `ApplyMeta` 回填 note/tags；全局列表
   `dispatchAISessionNoteUpdated`）。问题全部在前端：
   - a) `agent-hover-card.tsx` 的 `agentSessionIdFromBlockData()` 走
     `resolveAgentSessionId(meta).sessionId`，只认 `agent:sessionid` / `cmd`，
     而 GUI Chat block 的权威 id 在 `aisessions:sessionid`
     （对比 `agent.tsx:107` / `aisessions.tsx:534` 的 `getBoundSessionId()`）。
     → 卡片侧 sessionId 为空 → note 请求不发 → summary 为 null → note/tags 不渲染，
     且 `aisession-note-updated` 事件永远匹配不上。
   - b) `useSessionNote()` 的草稿只在 `sessionId` 变化时初始化
     （`React.useEffect(..., [sessionId])`）。summary 异步到达时草稿仍是 `""`，
     卡片显示 `Click to add a note...`；更糟的是自动保存 effect 把「空草稿 ≠ summary.note」
     当成用户编辑，3 秒后 `saveNote("")` **会把真实备注清空**。
   - c) `session-note-cache.ts` 一旦 `status === "loaded"` 就永不刷新，跨界面同步只靠
     window 事件；事件漏一次（监听器未挂载 / id 不匹配）就长期显示旧值。

## Goals

- Session Detail block 在现有 4 个 surface 上都有 InfoCard，展示标题、source/provider、
  tags、note 预览、路径、消息数、Open 操作。
- GUI Chat（Agent block，view=aisessions）也有卡片，复用会话卡片展示 tags/note（不重复展示模型/状态）。
- agent block 悬浮卡上的 note/tags 与全局 aisession 视图编辑的结果保持一致（实时事件 + 冷启动拉取）。
- 不引入「自动保存误清空备注」的回归。

## Non-Goals

- 不改后端 `Note/NoteAndTags/ApplyMeta` 语义，不改 sqlite 表结构。
- 不做卡片内的编辑功能增强（SessionDetailInfoCard 只读 + Open；编辑仍复用既有入口）。
- 不动 TUI 消息 rail（`TermAgentMessageRail` / `SessionOutlineRail`）。

## Requirements

### R1 InfoCard 覆盖新 block 类型

- R1.1 在 `BlockInfoCard()` 新增两个判定：`isSessionDetailMeta(meta)`（复用
  `frontend/app/view/aisessions/session-detail-block.ts` 的 `isSessionDetailMeta`）与
  chat 判定（`view === "aisessions"` 且 `aisessions:sessionid` 非空）。
- R1.2 判定顺序保持「Note → Preview → SessionDetail → Chat/Agent → null」，且 SessionDetail
  判定必须在 `isAgentTerminalMeta` 之前，避免同一 block 走错卡片。
- R1.3 `blockframe-header.tsx` 的 `isAgentBlock` 门槛从 `isTerminalBlock && isAgentTerminalMeta`
  放宽为「term block 或 aisessions 会话 block 且命中卡片分派」；不命中分派时仍不渲染
  （保持现状，不制造空卡片）。
- R1.4 `tab-info-card.tsx` 的 `classifyBlock` 新增 chat/session 分类，避免被归为 `other`
  时 Tab 卡片的内容构成统计误导。

### R2 SessionDetailInfoCard 内容

- R2.1 头部：source 图标 + 会话标题（`summary.title || id`）+ 可选的 live/标记状态。
- R2.2 tags：`summary.tags` 非空时渲染 chips；空时整段隐藏（不渲染空壳）。
- R2.3 note：首行预览，空时显示 `Click to add a note...` 占位；鼠标点击可展开编辑（复用
  既有的自动保存节拍 `NoteAutoSaveDelayMs`）。
- R2.4 元信息行：projectPath/filePath、messageCount、updatedAt 之一即可，取空不渲染。
- R2.5 `onOpen`：有则渲染成可点击按钮（激活 tab / 恢复布局），无则纯文本。
- R2.6 摘要未就绪时允许渲染卡片骨架（不返回 null），避免悬浮闪空；note/tags 段在
  summary 到达后补齐。

### R3 会话 id 解析统一

- R3.1 新增模块级纯函数 `resolveBlockSessionId(meta)`：`aisessions:sessionid` →
  `agent:sessionid` → `resolveAgentSessionId(meta).sessionId`，返回 `""` 表示无绑定。
- R3.2 `agentSessionIdFromBlockData()` 改为调用 `resolveBlockSessionId`。
- R3.3 `isAgentTerminalMeta` 的既有调用方保持语义不变；卡片判定改用
  「`resolveBlockSessionId(meta) !== ""` 或 `isAgentTerminalMeta(meta)`」的并集，
  具体命名与位置在 design.md 定。

### R4 note 草稿与缓存

- R4.1 `useSessionNote` 引入 `dirty`：只有用户输入过才自动保存；summary 首次到达且
  `!dirty` 时同步草稿；预览值来自 `summary.note`（未编辑时），编辑态才用草稿。
- R4.2 抽出共享 section 组件（head + note 预览/编辑 + tags chips + AI 生成入口），
  AgentHoverCard 与 SessionDetailInfoCard 共用，避免两处漂移。
- R4.3 `session-note-cache` 支持显式刷新：`ensureSessionNote` 增加
  `loadedAt` TTL / `status === "error"` 时重拉；窗口内不重复并发请求。
- R4.4 事件匹配归一化：比较 `summary.key` 拆出的 id、裸 id 与前缀 id，且 connection
  不同也允许更新本 connection 下的条目（remote key 与裸 id 是同一会话的不同写法）。

### R5 测试

- R5.1 `block-info-card.test.tsx`：SessionDetail 分派命中、空 summary 骨架、
  chat 分派命中、note 判定优先于 session 判定。
- R5.2 `resolveBlockSessionId` 纯函数单测：三种 meta 形态 + 空值。
- R5.3 `agent-hover-card`：summary 晚到时不会触发 `saveNote("")`（不清空备注）。
- R5.4 `session-note-cache`：TTL 重拉、事件归一化匹配。

## Acceptance Criteria

- [ ] Session Detail block 在 inline tab / block header / sidebar 上悬浮均有卡片，含 tags 与 note
- [ ] GUI Chat block（view=aisessions）悬浮有会话卡片（tags/note 可见）
- [ ] 全局 aisession 视图编辑 note/tags 后，agent block 卡片同帧或一次悬浮内更新
- [ ] 卡片冷启动（首次悬浮）拉到最新 note/tags
- [ ] 不存在「卡片打开 3 秒后备注被清空」的路径（有测试覆盖）
- [ ] Tab 信息卡的内容构成统计把 chat/session block 正确归类
- [ ] `pnpm --filter frontend test` 与 `pnpm --filter frontend lint` 通过（以 frontend 实际脚本为准）
- [ ] 现有 InfoCard surface 无回归

## Open Questions

- SessionDetailInfoCard 是否需要「Resume」按钮：本期不做，只做 Open。
