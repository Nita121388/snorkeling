---
id: N-1124-schedtask-entry-fix
title: "定时任务入口回归右侧 widget + 弹窗版式对齐 CommonText（11-24-schedtask-entry-fix）"
type: fix-small
priority: P2
severity: S2
status: open
origin: self
source: "2026-11-24T05:03:13Z"
task: 11-24-schedtask-entry-fix
order: 100
touch: [frontend/app/modals/**, frontend/app/workspace/**, frontend/app/session-overview/**, frontend/i18n/locales/**, pkg/wconfig/**, scripts/verify/scheduled-hero/**, docs/project/**, loop/red/**, .trellis/**]
rollback: null
budget: {minutes: 120, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T05:03:13Z"
---

# 定时任务入口回归右侧 widget + 弹窗版式对齐 CommonText（11-24-schedtask-entry-fix）

## 背景

需求：点右侧定时任务 widget 打开 CommonText 同款弹窗，不建块。commit 8939d11f5 做成 Overview 工具栏按钮，且弹窗无尺寸/14px 标题/实现语副标题，与 CommonText 版式差距大。

## 来源

- self：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/workspace/widget-actions.test.ts >/dev/null 2>&1 && echo VT_WA_OK` → `VT_WA_OK`
- [ ] `npx vitest run frontend/app/modals/scheduledtask-modal.test.tsx >/dev/null 2>&1 && echo VT_MODAL_OK` → `VT_MODAL_OK`
- [ ] `node scripts/i18n/check-parity.mjs >/dev/null 2>&1 && echo I18N_PARITY_OK` → `I18N_PARITY_OK`
- [ ] `npx eslint frontend/app/modals frontend/app/workspace frontend/app/session-overview >/dev/null 2>&1 && echo ESLINT_OK` → `ESLINT_OK`

## 记录

_（待补）_
