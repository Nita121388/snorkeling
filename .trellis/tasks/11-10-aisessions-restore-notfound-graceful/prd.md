# AISessions 恢复时 session not found 优雅降级

## Goal

重启恢复后，Agent GUI 块 / AISessions 块持有失效的 `aisessions:sessionid` 绑定时，`Detail` 报 `call aisessions.Detail error: session not found: <id>` 并以错误横幅展示。恢复路径应识别该错误为「绑定已失效」，**静默清掉 block meta 里的孤儿 id、回落 New Chat 空态**，而不是把内部错误甩给用户。

## 根因（已定位）

1. Agent GUI 块发首条消息时 pi 立即分配 session id，`bindNewSession()`（`agent.tsx:169`）**立即**把 `aisessions:sessionid` 写入 block meta。
2. pi 的 JSONL 文件要等**第一条 assistant 消息完成**才落盘（`pkg/aisessions/manager.go:1527` 注释明确该行为）。首条 assistant 消息未完成就重启 → 文件从未创建，id 成为孤儿（已实测确认：磁盘 / `~/.snorkeling` 索引 / 各 vendor 目录均无 `01a1c45f-…`）。
3. 重启后块恢复：`agent.tsx:680` mount effect 读 meta 残留 id → `loadDetailById()` → 后端 `resolveSession`（活注册表为空 + 无文件 + 无索引行）→ `session not found` → `errorAtom` → 错误横幅。
4. 同样问题存在于 `aisessions.tsx:617-625`（列表视图恢复选中会话）：`loadDetailById` 失败后虽会走 fallback 选择，但会把 `errorAtom` 留下，且**不清 meta** → 每次 tab 打开都重复失败。

## Requirements

- **R1** 新增错误判定助手 `isSessionNotFoundError(error, sessionId?)`：识别 `session not found: <id>` 文本（含可选 id 校验），放 `frontend/app/view/aisessions/utils.ts`（导出、可测试）。语义对齐 `session-overview.tsx:410` 的既有判定。
- **R2** `agent.tsx`：mount 恢复路径改为 `restoreBoundSession()` —— `loadDetailById` 失败且错误为 session-not-found 时：
  - 清 block meta：`aisessions:sessionid`/`agent:sessionid` → null（`SetMetaCommand`）；
  - 清 `errorAtom` / `detailAtom` / `detailLoadingAtom`；
  - `startNewSession()` 回到 New Chat 空态。
  - 非 not-found 的失败（连接、网络、瞬时）**保持现有报错行为**，不清绑定。
- **R3** `aisessions.tsx`：列表恢复路径中 `loadDetailById(boundSessionId)` 失败且为 session-not-found 时，同样清 meta + 清 `errorAtom`，再走既有 fallback 链（newchat → 首个会话）。非 not-found 失败保持现状。
- **R4** 不改后端、不改 RPC 契约、不改 `loadDetailById` 的用户主动调用语义（用户点会话行的 not-found 仍正常报错）。

## Non-goals

- 不做「`bindNewSession` 延迟持久化 meta」（root cause 加固）——有竞态（第二条消息发出前重启会丢有效绑定），留观察。
- 不动 session-overview.tsx 已有的 not-found 处理。

## Acceptance Criteria（机器可判定）

1. `frontend/app/view/aisessions/utils.test.ts` 新增 `isSessionNotFoundError` 用例 ≥5 条：正例（含 id / 不含 id 校验）、负例（network error / 文本巧合包含但 id 不匹配 / 空串）。
2. agent 模型行为测试（新建 `agent-restore-bound.test.ts`，jotai store + mock service）：
   - 恢复时 Detail 抛 `session not found` → `SetMetaCommand` 收到 `aisessions:sessionid: null`、`selectedKeyAtom === NewSessionKey`、`errorAtom === ""`；
   - Detail 抛网络错误 → 不清 meta、`errorAtom` 保留错误文本。
3. `npx vitest run frontend/app/view/aisessions/` 全绿（含既有 40+ 文件）。
4. `npx tsc --noEmit` 无新增 error。
5. `npx eslint <改动文件>` 0 error（若项目对改动路径启用）。

## Notes

- 复现时间线：会话 `01a1c45f-…` uuidv7 前缀解码 = 2026-11-10 15:32:22 本地时间，用户在其后重启。
- `SetMetaCommand` meta 值传 null 即删除键（`bindNewSession` 已有 `"aisessions:newchat": null` 用法）。
