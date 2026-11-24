---
id: N-1124-folder-index-badges-2
title: "文件夹索引徽标（实验插件）：index.md 状态表 + badges.js 脚本源 + Agent 定向刷新 Block"
type: feature
priority: P2
status: open
origin: self
source: "nita 2026-11-24 会话拍板：D1 index.md 表格 / D2 前缀 emoji / D3 只读用 🔒 / D4 独立 badges.js + worker / D5 复用 setmeta 事件链（v1 不加新 RPC）；id -2 因首建包缺判据被丢弃重建"
task: 11-24-folder-index-badges
order: 100
touch: [frontend/app/view/preview/folder-index/**, frontend/app/view/preview/preview-explorer.tsx, frontend/app/treeview/treeview.tsx, frontend/app/treeview/treeview-badge.test.tsx, loop/red/**, .trellis/tasks/11-24-folder-index-badges/**, docs/project/**]
rollback: null
budget: {minutes: 240, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T01:09:15Z"
---

# 文件夹索引徽标（实验插件）：index.md 状态表 + badges.js 脚本源 + Agent 定向刷新 Block

## 背景

_（待补）_

## 来源

- self：nita 2026-11-24 会话拍板：D1 index.md 表格 / D2 前缀 emoji / D3 只读用 🔒 / D4 独立 badges.js + worker / D5 复用 setmeta 事件链（v1 不加新 RPC）；id -2 因首建包缺判据被丢弃重建

## 验收判据

- [ ] `npx vitest run frontend/app/view/preview/folder-index/folder-index.test.ts >/dev/null 2>&1 && echo IDX_UNIT_OK` → `IDX_UNIT_OK`
- [ ] `npx vitest run frontend/app/view/preview/folder-index/refresh.test.ts >/dev/null 2>&1 && echo REFRESH_OK` → `REFRESH_OK`
- [ ] `npx vitest run frontend/app/treeview/treeview-badge.test.tsx >/dev/null 2>&1 && echo BADGE_RENDER_OK` → `BADGE_RENDER_OK`
- [ ] `npx tsc --noEmit 2>&1 | grep -E "folder-index|treeview-badge" | wc -l` → `0`

## 记录

_（待补）_
