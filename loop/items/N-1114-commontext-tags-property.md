---
id: N-1114-commontext-tags-property
title: "CommonText 详情标签移入属性区（Notion/Obsidian 式选择）"
type: fix-small
priority: P2
status: open
origin: self
source: "2026-11-14T07:40:00Z"
task: 11-14-commontext-tags-as-property
order: 100
touch: [frontend/app/commontext/commontext-compose-modal.tsx, frontend/app/commontext/commontext-compose-modal.dom.test.tsx, frontend/app/commontext/commontext-compose-modal.test.ts, scripts/verify/commontext-source-notion/, docs/project/verify-ledger.md]
rollback: null
budget: {minutes: 40, retries: 2}
releaseCandidate: false
createdAt: "2026-11-14T07:40:00Z"
---

# CommonText 详情标签移入属性区（Notion/Obsidian 式选择）

## 背景

详情区底部「All tags」面板独占一块纵向空间、且与属性网格割裂。改法：标签成为属性网格第一行 Tags，值区点击唤起共享 `PropertyTagEditor` 浮层（md 预览/ AISessions 同款 Wolai 式：chips+输入同行、输入过滤、全库候选带计数、无匹配「创建」、Backspace 删尾、Esc 关闭）；写回仍走正文 `#tag` 字面最小 diff + 既有 800ms 自动保存；底部面板整块删除。折叠摘要行首加 `#` 数量项。

## 来源

- self：nita 2026-11-14 会话 —— 「标签也作为属性移动到属性位置，不再在底部显示。而是参考 md 预览中类似于 Obsidian 和 Notion 的属性选择方式」→ 方案确认「ok go」。

## 验收判据

- [ ] `npx vitest run frontend/app/commontext/ --reporter=basic` → 全绿（15 文件，新增 ≥3 例）
- [ ] 红证：旧源（git show HEAD）跑新 dom 断言 → ≥1 failed

## 记录

- 2026-11-14 实施（方案确认「ok go」）：`commontext-compose-modal.tsx` 单文件——Tags 成为属性网格第一行
  （值区 SessionTagChips，点击唤起共享 `PropertyTagEditor`+`PropertyValuePopover`，全库候选带计数），
  折叠摘要首项加 `#` 数量，底部 All tags 面板整块移除，`handleDetailToggleTag` 重构为最小 diff 的
  `applyDetailTags`（仍写正文 #tag 字面 + 既有 800ms 自动保存）。
- 红证（G2）：旧源 3 failed → 新源 192 passed（15 files，dom 台新增 Tags 浮层交互 1 例 +
  断言更新，源码断言新增 1 例）。
- 真机台阻塞：Electron 启动器故障依旧（同日 07:02 launcher exit=201），本次未重复尝试；真机台已改
  property-grid-six-rows 并补 tags 浮层 9 条断言，修复后补跑（台账已记 skipped）。
