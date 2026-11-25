# 标题缓存 origin 维度：Header 标题与正文同源

> 背景：用户 2026-11-18 反馈「有时候打开的 sessions detail 内容和 Header 对不上」。Header 走
> `session-note-cache`（只按 `connection+sessionId` 建键、Summary 不带 origin），正文走带 origin 的
> Detail；后端 Detail/Summary 响应也不回填 origin 标签。外部 dump 会话的 tab 标题退化成
> "Session Details"，note/title/props 写操作落错 meta 库。

## Goal

1. 后端 Detail/Summary 在外部 origin 下回填 `summary.origin`（与 listAllOrigins 合并视图同口径）。
2. session-note-cache 缓存键加 origin 维度，Summary/NoteAndTags/SetProps 请求带 origin。
3. Header 标题、InfoCard、属性写入全链路从 block meta 的 `aisessions:origin:v1` 解析 origin 透传。

## Requirements

- **R1 后端**：`tagExternalOrigin`（空/`local`/`all` 不打标）；`Detail`/`Summary` 回填；
  `AISessionsSetPropsRequest` 加 `Origin` 并改走 `managerForScope`。
- **R2 缓存**：键 `connection\|origin\|sessionId`；六个公开函数加 origin 参数；事件匹配 `originCompatible`
  （事件无标签按旧行为，两边都有标签必须一致）。
- **R3 消费方**：`useSessionNoteState(sessionId, connection, origin?)`（`SessionNoteState.origin`）；
  `useBlockSessionTitle` 加 origin；`block.tsx` / `session-detail-info-card.tsx` / `session-overview`
  prime 从 meta 解析；`property-store.ts` / `session-note-section.tsx` 写入透传；Title/Mark 的 origin
  由硬编码 `""`（或误传 connection）改为真 origin。

## 非目标

- `Title` 请求没有 connection 字段：远端连接会话在卡片改名仍会报 session not found（需后端加字段，另开包）。
- `aisessions:titleupdated` 事件不带 origin，跨 origin 同 id 的事件可能串（`originCompatible` 只在两边都有标签时严格）。
- 不改标题优先级契约（user > ai > first_user_message …）。

## Acceptance Criteria（必须机器可判）

| # | 判据 | 命令 → 期望 |
|---|---|---|
| A1 | note-cache 行为基线不回归 | `npx vitest run frontend/app/store/session-note-cache.test.ts` → passed |
| A2 | block 面不回归 | `npx vitest run frontend/app/block` → passed |
| A3 | 服务层全绿（含新红证测试） | `go test ./pkg/service/aisessionsservice -count=1` → ok |
| A4 | 红证（修前） | `TestDetail_ExternalOriginTagsSummary` FAIL + `session-note-cache-origin.test.ts` 3 failed → 修后全绿 |
| A5 | 类型不回退 | `tsc --noEmit` error 数 = 55（= 修前基线） |
