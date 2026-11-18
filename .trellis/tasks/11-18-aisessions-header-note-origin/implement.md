# Implement — 标题缓存 origin 维度

提交：`fix(aisessions): 标题缓存加 origin 维度，Header 与正文同源`（N-1118-header-note-origin）。

## 实际改动

后端：

- `pkg/service/aisessionsservice/origins.go`：新增 `tagExternalOrigin`（空/`local`/`all` 不打标，与 listAllOrigins 同口径）。
- `aisessionsservice.go`：`Detail` / `Summary` 返回前回填 `summary.origin`；`AISessionsSetPropsRequest` 加 `Origin` 并改走 `managerForScope`。

前端：

- `session-note-cache.ts`：缓存键 `connection|origin|sessionId`；`ensureSessionNote`/`primeSessionNote`/`getSessionNoteSnapshot`/`subscribeSessionNote`/`saveSessionNote`/`saveSessionProps` 全部加 origin 维度；Summary/NoteAndTags/SetProps 请求带 origin；事件匹配 `originCompatible`（事件无标签按旧行为，两边都有标签必须一致）。
- `session-note-hook.ts`：`useSessionNoteState(sessionId, connection, origin?)`；`SessionNoteState.origin`；GenerateMetadata/GenerateTitle/Title/Mark 全部走 origin（原先硬编码 `""` 或误传 connection）。
- `use-block-session-title.ts` + `block.tsx`：tab 标题从 meta 的 `aisessions:origin:v1` 解析 origin 传入。
- `session-detail-info-card.tsx`：同上。
- `property-store.ts` + `session-note-section.tsx`：`setSessionProperty`/`patchSessionProperty`/`saveSessionProps` 增加 origin 并透传。
- `gotypes.d.ts`：`AISessionsSetPropsRequest.origin`（后端 tsgen 同步）。

## 验证

| 命令 | 结果 |
|---|---|
| `go test ./pkg/service/aisessionsservice -count=1` | ok（82s） |
| 红证 `TestDetail_ExternalOriginTagsSummary`（修前） | FAIL：expected origin tag, got "" → 修后 ok |
| `npx vitest run frontend/app/store/session-note-cache.test.ts` | 22/22 |
| `npx vitest run frontend/app/store/session-note-cache-origin.test.ts`（新增） | 3/3（修前 3 failed） |
| `npx vitest run frontend/app/block` | 153/153 |
| `npx tsc --noEmit -p tsconfig.json` | 55（= 基线） |

## 已知边界（「不做什么」的补充）

- `Title` 请求没有 `connection` 字段：远端连接会话在卡片里改名仍会走本机 manager 报 session not found（原本传 connection 当 origin 一样报错）。需要后端加字段，另开包。
- `aisessions:titleupdated` 事件不带 origin：跨 origin 同 id 的标题事件可能串（`originCompatible` 只在两边都有标签时才严格）。
- session-overview 三个 overview-board 测试文件的 11 个失败为修前已存在（干净 HEAD 复现），与本包无关。
