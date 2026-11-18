# 会话详情 origin/connection 传递：弹窗与详情块不再回落本机 manager

> 背景：用户 2026-11-18 反馈「有时候打开的 sessions detail 内容和 Header 对不上」。诊断发现三处入口
> 只传裸 id/key：`session-overview` 的 `openSessionDetail(row.sessionId)`、`agentcardmodal` 的
> `pushModal(..., {sessionId})`、`openAISessionDetailFromList` 不传 origin。后端 `managerForScope`
> 路由：origin → connection → `newLocalManager()`。外部 dump / 远端会话因此落到本机 manager，
> 报 session not found 或取到本机同名会话。

## Goal

1. 详情查询的 `connection` 与 `origin` 从打开方一路传到 Detail/DetailDelta/DetailTools 请求。
2. 从列表分开的详情块把外部 origin 写进 block meta（`aisessions:origin:v1`），新块恢复 origin。
3. 纯函数抽出（`sessionDetailBlockMeta` / `detailRequestScope`）并加红证测试。

## Requirements

- **R1** `session-detail-block.ts`：导出纯函数 `sessionDetailBlockMeta({sessionId, connection?, cwd?, origin?})`
  与 `normalizeDetailOrigin`；`openAISessionDetailFromList` / `openAISessionDetailBlock` 透传 origin。
- **R2** `aisessiondetailmodal.tsx`：props 增 `connection` / `origin`；导出 `detailRequestScope`，
  三处 service 请求统一带 scope（summary 的 origin 标签优先，打开方 scope 兜底，`local` 归一空串）。
- **R3** 调用方补参：`aisessions.tsx` 列表双击传 `model.originForSession(session)`；`session-detail.tsx`
  子会话卡传父会话 origin；`session-overview` timeline/board 两入口传 block connection；`agentcardmodal` 传 connection。

## 非目标

- 不改 note-cache（`N-1118-header-note-origin` 的范围）。
- 不改 `openAISessionNewChatFromList`（新会话只在本机跑）。
- 不改后端路由（`managerForScope` / `managerForOrigin` 已正确）。

## Acceptance Criteria（必须机器可判）

| # | 判据 | 命令 → 期望 |
|---|---|---|
| A1 | 详情块纯函数测试绿 | `npx vitest run frontend/app/view/aisessions/session-detail-block.test.ts` → passed |
| A2 | note-cache 不回归 | `npx vitest run frontend/app/store/session-note-cache.test.ts` → passed |
| A3 | 红证（修前） | `npx vitest run frontend/app/view/aisessions/detail-scope.test.ts` → 5 failed → 修后 5 passed |
| A4 | 类型不回退 | `npx tsc --noEmit -p tsconfig.json \| grep -c "error TS"` → ≤55（修前基线 55） |
