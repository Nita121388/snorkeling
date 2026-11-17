---
id: N-1117-conn-typeahead-row-rail-r2
title: "连接下拉：右栏图标居右对齐 + hover 一键复制 + 使用次数排序 + 打开时加载骨架"
type: fix-small
priority: P2
severity: S2
status: open
origin: self
source: "r1 丢弃重建：本机 Electron dev 实例 tabview init 实测 3-4 分钟（同 N-1113/N-1114-tab-restore-all 记录），真机台启动 120s 超时、prove 120s 阈也不够；改以单测 + 静态锚点判据，真机台 conn-typeahead-rail 保留待环境恢复后补跑。实现与 r1 相同（代码已在树里）。"
task: 11-17-conn-typeahead-row-rail
order: 100
touch: [frontend/app/modals/typeaheadmodal.tsx, frontend/app/modals/typeaheadmodal.scss, frontend/app/modals/typeaheadmodal.test.tsx, frontend/app/modals/conntypeahead.tsx, frontend/app/modals/conntypeahead.test.tsx, frontend/app/modals/conn-usage.ts, frontend/app/modals/conn-usage.test.ts, frontend/types/custom.d.ts, frontend/i18n/locales/en/modals.json, frontend/i18n/locales/zh/modals.json, scripts/verify/conn-typeahead-rail/**, scripts/verify/README.md, docs/project/verify-ledger.md, .trellis/tasks/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 45, retries: 1}
releaseCandidate: false
createdAt: "2026-11-17T07:35:23Z"
---

# 连接下拉：右栏图标居右对齐 + hover 一键复制 + 使用次数排序 + 打开时加载骨架

## 背景

四个同族缺陷，同一文件对：1) 右栏没居右：.typeahead-item-source 的 margin-left:auto 挂在内容宽度的 .typeahead-item-name 里，只把自己推到文字屁股后面；行级 .typeahead-current-checkbox 也在用 margin-left:auto，两个 auto 互相竞争。2) 无一键复制：行内没有动作区。3) 无加载骨架：connList 初始 []，suggestions 为空 → 面板塌成输入框再撑开。4) 排序只按 display:order（默认全 0），常用连接不上浮。

## 来源

- self：r1 丢弃重建：本机 Electron dev 实例 tabview init 实测 3-4 分钟（同 N-1113/N-1114-tab-restore-all 记录），真机台启动 120s 超时、prove 120s 阈也不够；改以单测 + 静态锚点判据，真机台 conn-typeahead-rail 保留待环境恢复后补跑。实现与 r1 相同（代码已在树里）。

## 验收判据

- [ ] `npx vitest run frontend/app/modals --reporter=basic && echo MODALS_TESTS_PASS` → `MODALS_TESTS_PASS`
- [ ] `npm run i18n:check && echo I18N_PASS` → `I18N_PASS`
- [ ] `node --check scripts/verify/conn-typeahead-rail/verify.mjs && findstr /C:typeahead-item-rail frontend/app/modals/typeaheadmodal.scss > nul && findstr /C:data-copy-conn frontend/app/modals/typeaheadmodal.tsx > nul && findstr /C:snorkeling:connUsage frontend/app/modals/conn-usage.ts > nul && echo E2E_AREA_WIRED` → `E2E_AREA_WIRED`

## 记录

_（待补）_
