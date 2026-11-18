# 标题缓存 origin 维度：Header 标题与正文同源

## 做什么

- 后端：`AISessionsService.Detail` / `Summary` 在外部 origin（非空且非 `local`）下把 `Origin` 回填进返回的 `SessionSummary.Origin`（沿用 `listAllOrigins` 的标签口径），前端据此把后续读写路由回同一 origin。
- `frontend/app/store/session-note-cache.ts`：缓存键加 origin 维度；`ensureSessionNote` / `primeSessionNote` / `subscribeSessionNote` / `getSessionNoteSnapshot` 增加 origin 参数；Summary 请求带 `origin`。
- `session-note-hook.ts` 的 `useSessionNoteState(sessionId, connection, origin?)` 透传。
- 调用方补 origin：`block.tsx`（从 meta 的 `OriginMetaKey` 解析）→ `useBlockSessionTitle`；`session-detail-info-card.tsx`、`agentcardmodal.tsx` 从 meta 取 origin。

## 不做什么

- 不改事件匹配口径（`aisessions:titleupdated` / `aisessionnoteupdated` 仍按 key/id 段匹配）；外部 origin 的标题生成事件暂不带 origin，跨 origin 同 id 仅在本机无同一会话时出现，风险记录在案。
- 不改 title 优先级（user > ai > first_user_message …）与 `ai:sessionautotitle` 开关。

## 验收判据

```bash
npx vitest run frontend/app/store/session-note-cache.test.ts   # passed
npx vitest run frontend/app/block                             # passed
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/service/aisessionsservice -count=1"  # ok
```

红证（G2，已登记）：`go test ./pkg/service/aisessionsservice -run TestDetail_ExternalOriginTagsSummary` → FAIL（summary 无 origin 标签）；`vitest session-note-cache-origin.test.ts` → 3 failed。
