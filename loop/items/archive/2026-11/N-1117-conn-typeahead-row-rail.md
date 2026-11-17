---
id: N-1117-conn-typeahead-row-rail
title: "连接下拉：右栏图标居右对齐 + hover 一键复制 + 使用次数排序 + 打开时加载骨架"
type: fix-small
priority: P2
severity: S2
status: open
origin: self
source: "2026-11-17 nita 会话：右侧 icon 需要居右对齐；希望鼠标悬浮出现一键复制 icon；点击下拉框时没有加载骨架动画；能否按照使用次数排序显示"
task: 11-17-conn-typeahead-row-rail
order: 100
touch: [frontend/app/modals/typeaheadmodal.tsx, frontend/app/modals/typeaheadmodal.scss, frontend/app/modals/typeaheadmodal.test.tsx, frontend/app/modals/conntypeahead.tsx, frontend/app/modals/conntypeahead.test.tsx, frontend/app/modals/conn-usage.ts, frontend/app/modals/conn-usage.test.ts, frontend/types/custom.d.ts, frontend/i18n/locales/en/modals.json, frontend/i18n/locales/zh/modals.json, scripts/verify/conn-typeahead-rail/**, scripts/verify/README.md, docs/project/verify-ledger.md, .trellis/tasks/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 120, retries: 1}
releaseCandidate: false
createdAt: "2026-11-17T06:07:48Z"
---

# 连接下拉：右栏图标居右对齐 + hover 一键复制 + 使用次数排序 + 打开时加载骨架

## 背景

四个同族缺陷，同一文件对：
1) 右栏没居右：.typeahead-item-source 的 margin-left:auto 挂在内容宽度的 .typeahead-item-name 里，只把自己推到文字屁股后面；行级 .typeahead-current-checkbox 也在用 margin-left:auto，两个 auto 互相竞争。.typeahead-item-name.ellipsis 的省略号也打不到文本（flex 匿名 item），长名字把右栏挤出去。
2) 无一键复制：行内没有动作区。
3) 无加载骨架：connList 初始 []，首帧 suggestions 为空 → .has-suggestions 为假 → 面板塌成一条输入框，RPC 回来再撑开。
4) 排序只按 display:order（默认全 0，等于后端返回顺序），常用连接不会上浮。

## 来源

- self：2026-11-17 nita 会话：右侧 icon 需要居右对齐；希望鼠标悬浮出现一键复制 icon；点击下拉框时没有加载骨架动画；能否按照使用次数排序显示

## 验收判据

- [ ] `npx vitest run frontend/app/modals --reporter=basic && echo MODALS_TESTS_PASS` → `MODALS_TESTS_PASS`
- [ ] `npm run i18n:check && echo I18N_PASS` → `I18N_PASS`
- [ ] `node scripts/verify/conn-typeahead-rail/verify.mjs && echo VERIFY_PASS` → `VERIFY_PASS`

## 记录

_（待补）_
