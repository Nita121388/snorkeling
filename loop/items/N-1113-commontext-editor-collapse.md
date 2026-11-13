---
id: N-1113-commontext-editor-collapse
title: "CommonText 弹窗：Editor 快捷收起 + 属性列表默认折叠"
type: bug
priority: P2
status: open
origin: self
source: "2026-11-13T14:47:11Z"
task: 11-13-commontext-editor-collapse-props-fold
order: 100
touch: [frontend/app/commontext/commontext-compose-modal.tsx, frontend/app/commontext/commontext-compose-modal.test.ts, scripts/verify/commontext-source-notion/, docs/project/verify-ledger.md]
rollback: null
budget: {minutes: 60, retries: 1}
releaseCandidate: false
createdAt: "2026-11-13T14:47:11Z"
---

# CommonText 弹窗：Editor 快捷收起 + 属性列表默认折叠

## 背景

上部 Editor 多行草稿展开后无法快速收起（失焦折叠判定只对无换行文本生效），下半部列表/详情被挤压；详情区属性网格 5 行固定占高且与 footer 元信息重复。改法：editor 加显式收起按钮（手动收起态优先级高于聚焦自动展开，Alt+Up 键盘通道），属性网格默认折叠成 icon+数字单行摘要，chevron 展开完整网格。

## 来源

- self：nita 2026-11-13 会话 —— 「commontext 界面上半部分的 Editor 能够放大；但是内部有内容，但同时想编辑下半部分内容时却无法将上半部分缩小。我希望能快捷得让下半部分放大…属性列表感觉完全可以默认折叠显示，折叠先用简单的 icon 数字控件就足以展示现有的属性信息」→ 方案确认「ok go」。

## 验收判据

- [ ] `npx vitest run frontend/app/commontext/commontext-compose-modal.test.ts` → `19 passed`
- [ ] `node scripts/verify/commontext-source-notion/verify.mjs` → `ALL GREEN`

## 记录

- 2026-11-13 实施（人确认后）：`commontext-compose-modal.tsx` 单文件改动 + 源码断言单测 + 新增 jsdom 组件级 DOM 台
  `commontext-compose-modal.dom.test.tsx`（editor 收起 / 属性折叠两组断言）+ 真机台 `commontext-source-notion`
  补属性折叠展开与 editor 收起断言。
- 红证（G2）：旧源（git show HEAD:…tsx）重跑 DOM 台 2 failed → 新源 2 passed。
- 真机台阻塞：Electron 启动器本机故障（基准台 newtab-empty 同故障；5 次 launch+reset 全 fatal：
  electron:dev exit 4/255、initPromise 120s 超时、CDP ECONNREFUSED）。行为断言由 jsdom 台兜住，
  真机像素证据待启动器修复后补跑（台账已记 skipped）。
- 坑已回写 `docs/project/ui-verify-playbook.md` §坑 6（jsdom 兜底路径 + globalStore/Provider 等三个前置坑）。
