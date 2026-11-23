---
id: N-1123-overview-drag
title: "Overview 看板 Agent 卡跨 Tab 拖拽（拖到目标 Tab 组/折叠组头 = 移动块）"
type: feature
priority: P1
status: open
origin: self
source: "nita 2026-11-23 15:11 布置、当晚拍板：拖到目标 Tab 组（含折叠组头）松手 = MoveBlock(blockId, tabId)"
task: 11-23-overview-drag
order: 100
touch: [frontend/app/session-overview/**, frontend/layout/lib/**, frontend/i18n/locales/**, docs/project/**, loop/red/**, .trellis/**]
rollback: null
budget: {minutes: 240, retries: 2}
releaseCandidate: false
createdAt: "2026-11-23T11:17:10Z"
---

# Overview 看板 Agent 卡跨 Tab 拖拽（拖到目标 Tab 组/折叠组头 = 移动块）

## 背景

复用既有原语：frontend/layout/lib/inlineTabs.ts moveBlockBetweenInlineTabNodes / removeBlockIdFromInlineTabNode；layoutModel.ts:1838 已有 pendingDrop 流程。卡片=block 投影，拖 A→B 后 tab(B).blockids +1、tab(A) -1，块数守恒。拖到当前 Tab/空白处必须 0 次 RPC。

## 来源

- self：nita 2026-11-23 15:11 布置、当晚拍板：拖到目标 Tab 组（含折叠组头）松手 = MoveBlock(blockId, tabId)

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview 2>&1 | tail -3` → `passed`
- [ ] `npx vitest run frontend/app/session-overview/overview-board-drag.test.ts 2>&1 | tail -4` → `passed`
- [ ] `npx vitest run frontend/layout/lib 2>&1 | tail -3` → `passed`

## 记录

_（待补）_
