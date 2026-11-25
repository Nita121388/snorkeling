---
id: N-1123-schedtask-modal
title: "定时任务管理面弹窗化（CommonText 同款 chrome，入口改工具栏按钮，不再建块）"
type: feature
priority: P2
status: open
origin: self
source: "nita 2026-11-23 15:11 布置、当晚拍板：定时任务弹窗化对齐 CommonText"
task: 11-23-schedtask-modal
order: 100
touch: [frontend/app/view/scheduledtasks/**, frontend/app/modals/**, frontend/app/modals/modalregistry.tsx, frontend/app/store/**, frontend/i18n/locales/**, frontend/app/block/**, docs/project/**, loop/red/**, .trellis/**]
rollback: null
budget: {minutes: 300, retries: 2}
releaseCandidate: false
createdAt: "2026-11-23T11:17:37Z"
feature: sched-task
---

# 定时任务管理面弹窗化（CommonText 同款 chrome，入口改工具栏按钮，不再建块）

## 背景

把 frontend/app/view/scheduledtasks/* 的列表+新建+编辑整体搬进 CommonText 式弹窗；开关走 modalregistry.tsx 已注册机制 + atoms.modalOpen（modal-open-registry 来源登记）；与 CommonText compose 同款 Modal chrome（标题/关闭/快捷键）。前置=N-1123-hero-sched-ui（编辑弹窗 hero 字段先落，避免同文件两次 merge）。

## 来源

- self：nita 2026-11-23 15:11 布置、当晚拍板：定时任务弹窗化对齐 CommonText

## 验收判据

- [ ] `npx eslint frontend/app/modals frontend/app/view/scheduledtasks frontend/app/store/modalmodel.ts >/dev/null 2>&1 && echo ESLINT_SCHED_OK` → `ESLINT_SCHED_OK`
- [ ] `npx vitest run frontend/app/modals >/dev/null 2>&1 && echo VT_MODALS_OK` → `VT_MODALS_OK`
- [ ] `npx vitest run frontend/app/modals/scheduledtask-modal.test.tsx >/dev/null 2>&1 && echo VT_MODAL_OK` → `VT_MODAL_OK`
- [ ] `node scripts/i18n/check-parity.mjs >/dev/null 2>&1 && echo I18N_PARITY_OK` → `I18N_PARITY_OK`

## 记录

_（待补）_
