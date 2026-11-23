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
---

# 定时任务管理面弹窗化（CommonText 同款 chrome，入口改工具栏按钮，不再建块）

## 背景

把 frontend/app/view/scheduledtasks/* 的列表+新建+编辑整体搬进 CommonText 式弹窗；开关走 modalregistry.tsx 已注册机制 + atoms.modalOpen（modal-open-registry 来源登记）；与 CommonText compose 同款 Modal chrome（标题/关闭/快捷键）。前置=N-1123-hero-sched-ui（编辑弹窗 hero 字段先落，避免同文件两次 merge）。

## 来源

- self：nita 2026-11-23 15:11 布置、当晚拍板：定时任务弹窗化对齐 CommonText

## 验收判据

- [ ] `npx vitest run frontend/app/view/scheduledtasks 2>&1 | tail -3` → `passed`
- [ ] `npx vitest run frontend/app/modals 2>&1 | tail -3` → `passed`
- [ ] `npm run i18n:check && echo I18N_OK` → `I18N_OK`
- [ ] `npx vitest run frontend/app/modals/scheduledtask-modal.test.tsx 2>&1 | tail -4` → `passed`

## 记录

_（待补）_
