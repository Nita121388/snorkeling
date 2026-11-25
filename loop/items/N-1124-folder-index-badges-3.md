---
id: N-1124-folder-index-badges-3
title: "文件夹索引徽标（实验插件）：index.md 状态表 + badges.js 脚本源 + Agent 定向刷新 Block"
type: feature
priority: P2
status: open
origin: self
source: "nita 2026-11-24 会话拍板（同 N-1124-folder-index-badges-2，因判据 bash 语法在 cmd.exe 必红 + tsc 超 120s 重建；PRD prdHash 与红证不变）；D1 index.md 表格 / D2 前缀 emoji / D3 只读用 🔒 / D4 独立 badges.js + worker / D5 复用 setmeta 事件链（v1 不加新 RPC）"
task: 11-24-folder-index-badges
order: 100
touch: [frontend/app/view/preview/folder-index/**, frontend/app/view/preview/preview-explorer.tsx, frontend/app/treeview/treeview.tsx, frontend/app/treeview/treeview-badge.test.tsx, loop/red/**, .trellis/tasks/11-24-folder-index-badges/**, docs/project/**]
rollback: null
budget: {minutes: 240, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T02:16:18Z"
feature: idx-badges
---

# 文件夹索引徽标（实验插件）：index.md 状态表 + badges.js 脚本源 + Agent 定向刷新 Block

## 背景

_（待补）_

## 来源

- self：nita 2026-11-24 会话拍板（同 N-1124-folder-index-badges-2，因判据 bash 语法在 cmd.exe 必红 + tsc 超 120s 重建；PRD prdHash 与红证不变）；D1 index.md 表格 / D2 前缀 emoji / D3 只读用 🔒 / D4 独立 badges.js + worker / D5 复用 setmeta 事件链（v1 不加新 RPC）

## 验收判据

- [ ] `npx vitest run frontend/app/view/preview/folder-index/folder-index.test.ts && echo IDX_UNIT_OK` → `IDX_UNIT_OK`
- [ ] `npx vitest run frontend/app/view/preview/folder-index/refresh.test.ts && echo REFRESH_OK` → `REFRESH_OK`
- [ ] `npx vitest run frontend/app/treeview/treeview-badge.test.tsx && echo BADGE_RENDER_OK` → `BADGE_RENDER_OK`
- [ ] `npx eslint frontend/app/view/preview/folder-index/ frontend/app/view/preview/preview-explorer.tsx frontend/app/treeview/treeview.tsx frontend/app/treeview/treeview-badge.test.tsx && echo LINT_OK` → `LINT_OK`

## 记录

_（待补）_
