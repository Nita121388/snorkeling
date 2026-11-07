---
id: N-1106-agent-card-tag-picker
title: "Agent 卡片标签选择器：候选项多选 + 计数"
type: feature
priority: P2
status: open
origin: self
source: "nita 2026-11-06 会话要求：标签支持展示现有全部标签 + 选择 + 候选显示计数"
task: 11-06-agent-card-tag-picker
order: 30
touch: [frontend/app/store/available-session-tags.ts, frontend/app/store/available-session-tags.test.ts, frontend/app/view/aisessions/property/multi-select-picker.tsx, frontend/app/view/aisessions/property/multi-select-picker.dom.test.tsx, frontend/app/view/aisessions/property/property-list.tsx, frontend/app/view/aisessions/property/property-list.scss, frontend/app/view/aisessions/property/property-model.ts, frontend/app/element/info-card/session-note-section.tsx, frontend/app/view/aisessions/aisessions.tsx, scripts/verify/agent-card-tags/**, scripts/verify/README.md, docs/project/verify-ledger.md, docs/project/ui-verify-playbook.md, .trellis/tasks/11-06-agent-card-tag-picker/**, .trellis/spec/**]
rollback: "git revert 单提交；multiSelectOptions 为可选 prop，回滚后卡片退回逗号文本框，无数据迁移、无 RPC 变更"
budget: {minutes: 150, retries: 2}
releaseCandidate: false
createdAt: "2026-11-06T05:03:35Z"
---

# Agent 卡片标签选择器：候选项多选 + 计数

## 背景

agent 卡片的 tags 编辑是逗号分隔自由文本框（property-list.tsx InlineEditor draft.split）；全局标签清单已由 Tags RPC 提供（SessionTagSummary{tag,count}）但只喂 aisessions 筛选面板。本次把清单上提到共享 store 并做候选项多选控件。

## 来源

- self：nita 2026-11-06 会话要求：标签支持展示现有全部标签 + 选择 + 候选显示计数

## 验收判据

- [ ] `npx vitest run frontend/app/view/aisessions/property` → `passed`
- [ ] `npx vitest run frontend/app/view/aisessions` → `passed`
- [ ] `grep -c "draft.split" frontend/app/view/aisessions/property/property-list.tsx` → `0`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=69`

## 记录

_（待补）_
