---
id: N-1124-idxbadges-decoration-protocol
title: "目录装饰协议 v2：词表泛化（icon/labelColor/hidden/order）+ 自定义状态注册表 + 脚本全树上下文"
type: feature
priority: P2
status: open
origin: self
source: "nita 2026-11-24 会话拍板「ok go on」：A 包 = 词表泛化；渲染只挂既有扩展口"
task: 11-24-idxbadges-decoration-protocol
order: 100
touch: [frontend/app/view/preview/folder-index/**, frontend/app/view/preview/preview-explorer.tsx, frontend/app/treeview/treeview.tsx, frontend/app/treeview/treeview-badge.test.tsx, loop/red/**, .trellis/tasks/11-24-idxbadges-decoration-protocol/**, docs/project/**]
rollback: null
budget: {minutes: 150, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T03:55:42Z"
feature: idx-badges
---

# 目录装饰协议 v2：词表泛化（icon/labelColor/hidden/order）+ 自定义状态注册表 + 脚本全树上下文

## 背景

_（待补）_

## 来源

- self：nita 2026-11-24 会话拍板「ok go on」：A 包 = 词表泛化；渲染只挂既有扩展口

## 验收判据

- [ ] `npx vitest run frontend/app/view/preview/folder-index/folder-index.test.ts && echo IDX_UNIT_OK` → `IDX_UNIT_OK`
- [ ] `npx vitest run frontend/app/view/preview/folder-index/refresh.test.ts && echo REFRESH_OK` → `REFRESH_OK`
- [ ] `npx vitest run frontend/app/treeview/treeview-badge.test.tsx && echo BADGE_RENDER_OK` → `BADGE_RENDER_OK`
- [ ] `npx eslint frontend/app/view/preview/folder-index/ frontend/app/view/preview/preview-explorer.tsx frontend/app/treeview/treeview.tsx && echo LINT_OK` → `LINT_OK`

## 记录

_（待补）_
