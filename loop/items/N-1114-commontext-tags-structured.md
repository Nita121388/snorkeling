---
id: N-1114-commontext-tags-structured
title: "CommonText 内容与标签分离（tags 结构化权威 + 读路径惰性迁移）"
type: feature
priority: P1
status: open
origin: self
source: "2026-11-14T10:50:00Z"
task: 11-14-commontext-tags-structured
order: 100
touch: [frontend/app/commontext/commontext-model.ts, frontend/app/commontext/commontext-model.test.ts, frontend/app/commontext/commontext-compose-modal.tsx, frontend/app/commontext/commontext-compose-modal.dom.test.tsx, frontend/app/commontext/commontext-compose-modal.test.ts, scripts/verify/commontext-source-notion/, docs/project/verify-ledger.md]
rollback: null
budget: {minutes: 90, retries: 2}
releaseCandidate: false
createdAt: "2026-11-14T10:50:00Z"
---

# CommonText 内容与标签分离（tags 结构化权威 + 读路径惰性迁移）

## 背景

正文是唯一权威：tag 以 `#tag` 字面住在 `text` 里，`item.tags` 只是派生快照——正文里的 `#` 永远在。改法（方案已确认）：`item.tags` 成为唯一权威、text 纯内容；读路径 `normalizeCommonTextItem` 惰性迁移历史字面（mergedTags ∪ extract、stripSessionTagHashes 剥字面、剥空回退原文保条目）；写路径五处收口（detailTags 读 item.tags、applyDetailTags 即时写 tags 不再改正文、flushDetailSave/Pin 用 item.tags、「+」创建时拆分草稿）。

## 来源

- self：nita 2026-11-14 会话 —— 「CommonText的文本中为什么还是显示#标签 我希望内容和标签分离」→ 方案确认「ok go」。

## 验收判据

- [ ] `npx vitest run frontend/app/commontext/ --reporter=basic` → 全绿（含迁移幂等/保条目/#!/bin/bash 安全 + 分离行为断言）
- [ ] 红证：旧源跑新断言 → ≥1 failed

## 记录

- 2026-11-14 实施（方案确认「ok go」）：读路径 `normalizeCommonTextItem` 惰性迁移
  （mergedTags ∪ extract + stripSessionTagHashes 剥字面、剥空回退原文）；写路径五处收口
  （detailTags 读 item.tags、applyDetailTags 先 flush 再即时写 tags 不再改正文、flushDetailSave/Pin
  用 item.tags、「+」创建时拆分草稿、placeholder 去 #tag 提示）。
- 红证（G2）：旧源 5 failed（迁移 3 例 + dom 正文含 '#urgent' + 源码断言）→ 新源 197 passed
  （15 files，+3 迁移单测；dom upsert mock 改为同构写回 settings atom）。
- 门：g1（nita 会话内「ok go」签）、g2（红证）、g5（合规：prettier/tsc/全绿 + 未写白名单外）
  → 3/3 clear；g7 待人验收。
- 已在 `.trellis/tasks/11-07-commontext-sync-transport/NOTES-tags-structured.md` 给同步任务留
  跨机混合版本风险 note（text 语义变化可能引发一次冲突）。
- 真机台断言改分离语义（tags-create-separate-from-text / tags-remove-drops-tag）；
  启动器故障依旧，台账 skipped。
