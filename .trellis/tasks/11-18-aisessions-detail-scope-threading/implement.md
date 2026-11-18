# Implement — 会话详情 origin/connection 传递

提交：`fix(aisessions): 详情弹窗与详情块把 connection/origin 传全`（N-1118-detail-scope-threading）。

## 实际改动

- `session-detail-block.ts`：抽出纯函数 `sessionDetailBlockMeta`（导出，可单测）与 `normalizeDetailOrigin`；外部 origin 写 `aisessions:origin:v1`（`buildOriginMeta`）。`openAISessionDetailFromList` / `openAISessionDetailBlock` 增加 origin 选项。
- `aisessiondetailmodal.tsx`：新增 props `connection`/`origin`；导出纯函数 `detailRequestScope`，Detail/DetailDelta/DetailTools 三处请求统一带 scope（已加载 summary 的 origin 标签优先，打开方 scope 兜底）。
- `aisessions.tsx`：列表打开详情块传 `model.originForSession(session)`。
- `session-detail.tsx`：子会话卡打开详情传 `normalizeDetailOrigin(summary?.origin)`（子会话与父会话同 origin）。
- `session-overview.tsx`：`openSessionDetail(sessionId, connection)`；`blockConnectionOf` 从 block meta 解析连接，timeline/board 两入口补传。
- `agentcardmodal.tsx`：`pushModal("AISessionDetailModal", {sessionId, connection})`。
- `detail-scope.test.ts`（新增红证）：`sessionDetailBlockMeta` origin 落键 + `detailRequestScope` 三态。

## 验证

| 命令 | 结果 |
|---|---|
| `npx vitest run frontend/app/view/aisessions/session-detail-block.test.ts` | passed |
| `npx vitest run frontend/app/store/session-note-cache.test.ts` | passed |
| 红证 `detail-scope.test.ts`（修前） | 5 failed → 修后 5 passed |
| `npx tsc --noEmit -p tsconfig.json` | 55 errors（= 修前基线 55，全部既有） |
| `npx vitest run frontend/app/block` | 153/153 |
| gitnexus detect_changes | risk low |

## 并发说明

本包提交时工作区有另一会话（overview-select-component）同时在改 `session-overview.tsx`；
已按 hunk 拆分，只提交本包的 6 个 hunk，未包含对方的 AppSelect 改动。
