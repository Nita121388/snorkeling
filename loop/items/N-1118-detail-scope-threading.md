---
id: N-1118-detail-scope-threading
title: "会话详情弹窗/详情块丢失 connection 与 origin，Detail 回落本机 manager"
type: bug
priority: P1
severity: S2
status: open
origin: self
source: "nita 2026-11-18：打开的 session detail 内容和 header 对不上；根因之一是入口只传裸 id"
task: 11-18-aisessions-detail-scope-threading
order: 100
touch: [frontend/app/modals/**, frontend/app/session-overview/**, frontend/app/view/aisessions/**, frontend/app/store/session-note-cache.ts, frontend/app/store/session-note-hook.ts, frontend/app/block/use-block-session-title.ts, frontend/app/block/block.tsx, .trellis/tasks/11-18-aisessions-detail-scope-threading/**, .trellis/spec/**]
rollback: "git revert 单提交；改动只是把已有参数传全，无数据迁移"
budget: {minutes: 90, retries: 2}
releaseCandidate: false
createdAt: "2026-11-18T05:17:22Z"
---

# 会话详情弹窗/详情块丢失 connection 与 origin，Detail 回落本机 manager

## 背景

session-overview 的 openSessionDetail(row.sessionId)、agentcardmodal 的 pushModal 只传裸 id；openAISessionDetailFromList 不传 origin。三者都会让 Detail 走 managerForIdentifier → newLocalManager()。

## 来源

- self：nita 2026-11-18：打开的 session detail 内容和 header 对不上；根因之一是入口只传裸 id

## 验收判据

- [ ] `npx vitest run frontend/app/view/aisessions/session-detail-block.test.ts` → `passed`
- [ ] `npx vitest run frontend/app/store/session-note-cache.test.ts` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=55`

## 记录

_（待补）_
