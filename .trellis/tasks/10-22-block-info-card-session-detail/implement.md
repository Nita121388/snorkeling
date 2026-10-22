# 实施计划：InfoCard 覆盖 SessionDetail/Chat + note/tags 同步修复

## 0. 前置（不可跳过）

- [ ] `gitnexus analyze`（当前索引 stale：index@9021395 / HEAD@eeb1292）
- [ ] 对 `isAgentTerminalMeta`、`BlockInfoCard`、`agentSessionIdFromBlockData`、
      `useSessionNote`、`ensureSessionNote` 重跑
      `gitnexus impact <symbol> --direction upstream`，把风险写回 `design.md` §2；
      若 `isAgentTerminalMeta` 仍为 HIGH，则确认 §3.1 的「不改语义」方案已落地
- [ ] 读 `.trellis/spec/snorkeling-docs/frontend/index.md` 及其下各 guide 的实际内容

## 1. 纯函数层（先写测试，可独立验证）

- [x] 新建 `frontend/app/block/block-info-card-meta.ts`
  - `resolveBlockSessionId(meta)`
  - `isSessionDetailBlockMeta(meta)`
  - `isChatBlockMeta(meta)`
  - `isAgentCardMeta(meta)`
- [x] 新建 `frontend/app/block/block-info-card-meta.test.ts`
  - `{ "aisessions:sessionid": "x" }` → `x`
  - `{ "agent:sessionid": "y" }` → `y`
  - `{ cmd: "codex resume z" }` → `z`（回退 resolveAgentSessionId）
  - 空 meta / 空串 / 纯空格 → `""`
  - 详情/session/chat 判定的正反例

验证：`npx vitest run frontend/app/block/block-info-card-meta.test.ts`

## 2. 共享 note 状态 hook

- [x] 新建 `frontend/app/store/session-note-hook.ts`（或 `view/term/use-session-note.ts`，
      按 spec 的目录约定择一，倾向 `app/store/` 与 `session-note-cache` 同层）
  - 从 `agent-hover-card.tsx` 的 `useSessionNote` 迁移逻辑
  - 新增 `dirty`、程序化同步、预览取 `summary.note`
  - 保留 AI 元数据生成所需的 `service` / `summary` / `connection`
- [x] 新建 `frontend/app/element/info-card/session-note-section.tsx`
  - head（title + wand 按钮）+ note 预览/编辑 + tags chips + 错误/状态提示
  - props 只依赖第 2 步 hook 的返回值，UI 与数据解耦
- [x] 单测 `frontend/app/store/session-note-hook.test.tsx`
  - summary 晚到：草稿同步，`dirty === false`，不触发保存
  - 用户输入后：`dirty === true`，防抖到期触发一次保存
  - summary 更新但用户正在编辑：不覆盖草稿

## 3. session-note-cache 刷新与匹配

- [x] `frontend/app/store/session-note-cache.ts`
  - `NoteRefreshTtlMs = 30_000`
  - `ensureSessionNote(..., { force })`：loaded 且超 TTL 时后台刷新（保留旧快照）
  - `sessionIdMatches(candidate, sessionId)` 归一化（裸 id / `source:id:path` / 前缀）
  - 事件处理改用归一化匹配
- [x] 单测 `frontend/app/store/session-note-cache.test.ts`
  - TTL 内不重复请求；超 TTL 重拉一次；在途不重复
  - 事件 summary 用 `key` 形态也能命中裸 id 条目（review 关注点）

## 4. 分派接入

- [x] `frontend/app/block/block-info-card.tsx`
  - 新增 SessionDetail / Chat 分支，返回 `SessionDetailInfoCard` / `AgentHoverCard`
  - 分派顺序：Note → Preview → SessionDetail → Chat → Agent → null
- [x] 新建 `frontend/app/block/session-detail-info-card.tsx`
  - 用 `session-note-cache` + `SessionNoteSection`
  - 身份段（source/标题/消息数）+ 路径段（`onOpen`）
  - summary 未就绪时渲染骨架而非 null
- [x] 单测 `frontend/app/block/block-info-card.test.tsx`（分派顺序 + 空态）

## 5. 调用面收尾

- [x] `frontend/app/view/term/agent-hover-card.tsx`
  - `agentSessionIdFromBlockData` 改调 `resolveBlockSessionId`
  - 内联 note UI 换成 `SessionNoteSection` + 新 hook（删除重复实现）
- [x] `frontend/app/block/blockframe-header.tsx:560`
  - `isAgentBlock` 换成 `isAgentCardMeta(meta)`（去掉 `isTerminalBlock` 前置）
- [x] `frontend/app/tab/tab-info-card.tsx`
  - `classifyBlock` 增加 `chat`；`counts` / chips / agent 清单分离

## 6. 质量门

- [x] `npx vitest run` 相关测试（block / store / tab）
- [x] `npx tsc --noEmit`（或 `pnpm check`，以 package.json 脚本为准）
- [x] `npx eslint frontend/app/block frontend/app/store frontend/app/view/term frontend/app/tab`
- [ ] `gitnexus detect-changes` 确认改动只落在预期符号
- [ ] CDP 手工验证（见 design.md §6.2），贴截图/观测证据到 task notes

## 7. 回滚点

- 每个步骤独立 commit 语义：1（纯函数）→ 2-3（数据层）→ 4-5（UI 接入）
- 若 UI 接入出问题，单独 revert 4-5 即可，数据层修复仍保留价值

## 8. 提交

- [x] 更新 `.trellis/spec/snorkeling-docs/frontend/component-guidelines.md`（InfoCard 分派约定）
- [ ] commit message：`feat(block-info-card): cover session detail and chat blocks; sync session note/tags`