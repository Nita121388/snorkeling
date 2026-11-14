---
id: N-1114-commontext-tags-summary-chips
title: "CommonText 折叠摘要标签样式与展开态统一（chip）"
type: fix-small
priority: P2
status: open
origin: self
source: "2026-11-14T10:05:00Z"
task: 11-14-commontext-tags-summary-chips
order: 100
touch: [frontend/app/commontext/commontext-compose-modal.tsx, frontend/app/commontext/commontext-compose-modal.dom.test.tsx, docs/project/verify-ledger.md]
rollback: null
budget: {minutes: 20, retries: 1}
releaseCandidate: false
createdAt: "2026-11-14T10:05:00Z"
---

# CommonText 折叠摘要标签样式与展开态统一（chip）

## 背景

折叠摘要 tags 项现为标签名 join 纯文本，与展开态 chip 视觉不统一。改法：tags 项特判渲染 `SessionTagChips`（与展开态/列表行同组件），空态仍 `0` 占位；容器允许收缩 + flex-wrap。

## 来源

- self：nita 2026-11-14 会话 —— 「折叠时的标签样式不好看 需要和展开式的样式统一」。

## 验收判据

- [ ] `npx vitest run frontend/app/commontext/ --reporter=basic` → 全绿（含新断言：摘要 tags 项内含 chip 按钮）
- [ ] 红证：旧源跑新断言 → failed

## 记录

- 2026-11-14 实施：折叠摘要 tags 项改为渲染 `SessionTagChips`（与展开态同一组件，样式/尺寸统一；
  旧 join 纯文本废弃）；空态 `0` 占位；容器允许收缩 + flex-wrap，标签多时换行不挤其他摘要项。
- 红证（G2）：旧源（join 文本）跑新断言 → 2 failed（摘要内无 chip button：expected null not to
  be null + 源码断言）；新源 194 passed（15 files）。
