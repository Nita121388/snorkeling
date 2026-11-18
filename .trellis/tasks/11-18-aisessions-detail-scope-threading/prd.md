# 会话详情的 origin/connection 传递

## 做什么

- 抽出纯函数 `sessionDetailBlockMeta({sessionId, connection?, cwd?, origin?})`（`frontend/app/view/aisessions/session-detail-block.ts`），新建详情块时写 `aisessions:origin:v1`（`buildOriginMeta`），本地 origin 不写。
- `openAISessionDetailFromList` / `openAISessionDetailBlock` 增加 `origin` 选项并透传；`aisessions.tsx` 的列表打开调用传 `model.originForSession(session)`。
- 抽出纯函数 `detailRequestScope(summary, fallback?)`（`frontend/app/modals/aisessiondetailmodal.tsx`），统一算 Detail/DetailDelta/DetailTools 的 `{id, connection, origin}`：优先用已加载 summary 的 origin 标签，其次用打开方传入的 scope，`local` 归一成空串。
- `AISessionDetailModal` 增加可选 `connection` / `origin` props 并让三处 service 调用带上。
- 打开方补参：`session-overview` 的 `openSessionDetail(sessionId, connection)`（timeline / board 两个入口）、`agentcardmodal` 的 `pushModal("AISessionDetailModal", {sessionId, connection})`。
- `session-detail.tsx` 的子会话卡片打开详情时传当前 block 的 origin。

## 不做什么

- 不改 note-cache（那是 `N-1118-header-note-origin` 的范围）。
- 不改 `openAISessionNewChatFromList`：新会话只在本机跑。
- 不改后端 origin 路由（`managerForScope` / `managerForOrigin` 已正确）。

## 验收判据

```bash
npx vitest run frontend/app/view/aisessions/session-detail-block.test.ts   # passed
npx vitest run frontend/app/store/session-note-cache.test.ts               # passed
npx tsc --noEmit -p tsconfig.json | grep -c "error TS"                     # <=55（当前基线 55）
```

红证（G2，已登记）：`vitest detail-scope.test.ts` → 5 failed（origin 不落 meta、Detail 请求不带 scope）。
