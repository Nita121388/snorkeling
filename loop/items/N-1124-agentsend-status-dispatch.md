---
id: N-1124-agentsend-status-dispatch
title: "Agent 卡常驻发送状态 + 异步派发回执可见（292/aaaa 事故根因）"
type: feature
priority: P2
status: open
origin: internal
source: "2026-11-24T08:46:17Z"
task: 11-24-agentsend-status
order: 100
touch: [frontend/app/session-overview/**, frontend/i18n/locales/**, scripts/verify/overview-board/**, docs/project/**, .trellis/**, loop/**]
rollback: null
budget: {minutes: 150, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T08:46:17Z"
feature: agentsend
---

# Agent 卡常驻发送状态 + 异步派发回执可见（292/aaaa 事故根因）

## 背景

用户 2026-11-24 反馈概览看板发送了它没发过的内容（292/aaaa）。取证：该文本是 pi 会话 7df5a37d 的 seq=2 user 消息，时间 07:10:35.447，比用户长消息早 414ms；来源是新建 agent 首发消息走 async 后台派发（session-overview.tsx:3079），整个投递过程 UI 不可见。方案：CardSendContext 新增 dispatchByBlock/markDispatching/markDispatchReceipt；SendStatusChip 常驻看板卡与列表行（data-board-send-status / data-row-send-status）；派发中懒拉 AgentDispatchGetCommand，3s 重查上限 40 次。已知限制：pkg/agentdispatch 纯内存，重启即丢（v1 不落盘），重启后无记录不得显示未发送。

## 来源

- internal：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/send-status-chip.test.tsx && echo N1124_CHIP_OK` → `N1124_CHIP_OK`
- [ ] `npx vitest run frontend/app/session-overview/overview-dispatch-status.test.tsx && echo N1124_DISPATCH_OK` → `N1124_DISPATCH_OK`

## 记录

_（待补）_
