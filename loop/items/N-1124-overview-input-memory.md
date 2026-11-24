---
id: N-1124-overview-input-memory
title: "Overview 输入记忆：新建弹窗记住 agent 类型 + composer 草稿持久化 + 存 CommonText icon"
type: feature
priority: P2
status: open
origin: internal
source: "2026-11-24T08:46:10Z"
task: 11-24-overview-input-memory
order: 100
touch: [frontend/app/session-overview/**, frontend/app/commontext/**, frontend/i18n/locales/**, docs/project/**, .trellis/**, loop/**]
rollback: null
budget: {minutes: 150, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T08:46:10Z"
---

# Overview 输入记忆：新建弹窗记住 agent 类型 + composer 草稿持久化 + 存 CommonText icon

## 背景

用户 2026-11-24 反馈：在 Tab 列选择新建 agent、或发送给 agent 的内容希望默认存储下来，避免再次新建或打开就消失；另需支持手动存到 CommonText（UI 增加一个 icon）。现状：add-agent 弹窗每次默认选第一项、内容关掉即丢；useCardSendState 的 draftByBlock 纯内存（overview-card-send-panel.tsx:79）。方案：localStorage（sessionoverview:senddrafts / sessionoverview:addagent），防抖 400ms、maxEntries 50、14 天过期、单条 8KB；存 CommonText 复用 upsertCommonTextItem，重复内联提示不弹窗。

## 来源

- internal：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-input-memory.test.ts && echo N1124_MEM_OK` → `N1124_MEM_OK`
- [ ] `npx vitest run frontend/app/session-overview/overview-card-send-panel.dom.test.tsx && echo N1124_PANEL_OK` → `N1124_PANEL_OK`
- [ ] `node scripts/i18n/check-parity.mjs && echo N1124_I18N_OK` → `N1124_I18N_OK`

## 记录

_（待补）_
