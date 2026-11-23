---
id: N-1123-hero-group-emoji
title: "AISessions Hero 折叠组头只留 emoji（不画 fa-folder/folder-open）"
type: fix-small
priority: P2
severity: S3
status: open
origin: self
source: "nita 2026-11-23 15:11 布置、当晚拍板：Hero 折叠栏只留 emoji；普通项目组不变"
task: 11-23-hero-group-emoji
order: 100
touch: [frontend/app/view/aisessions/session-group.tsx, frontend/app/view/aisessions/session-group.test.tsx, frontend/app/view/aisessions/utils.ts, frontend/app/view/aisessions/utils.test.ts, docs/project/**, loop/red/**, .trellis/**]
rollback: null
budget: {minutes: 90, retries: 2}
releaseCandidate: false
createdAt: "2026-11-23T11:17:37Z"
---

# AISessions Hero 折叠组头只留 emoji（不画 fa-folder/folder-open）

## 背景

锚点 frontend/app/view/aisessions/session-group.tsx:93-103（组头固定画 fa-folder/fa-folder-open/fa-inbox）；group.heroId 字段已有（utils.ts:356 heroIdOfSession）。hero 组头：hero 自身 emoji（roster），回落 🎭；普通项目组与未归类组（fa-inbox）不变。

## 来源

- self：nita 2026-11-23 15:11 布置、当晚拍板：Hero 折叠栏只留 emoji；普通项目组不变

## 验收判据

- [ ] `npx vitest run frontend/app/view/aisessions 2>&1 | tail -3` → `passed`
- [ ] `npx vitest run frontend/app/view/aisessions/session-group.test.tsx 2>&1 | tail -4` → `passed`

## 记录

_（待补）_
