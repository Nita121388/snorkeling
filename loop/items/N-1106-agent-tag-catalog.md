---
id: N-1106-agent-tag-catalog
title: "Agent 卡片标签候选：全局清单 + 计数"
type: feature
priority: P2
status: open
origin: self
source: "nita 2026-11-06：标签支持展示现有所有标签并选择 + 候选显示数量"
task: 11-06-agent-card-tag-picker
order: 30
touch: [frontend/app/store/available-session-tags.ts, frontend/app/store/available-session-tags.test.ts, frontend/app/element/property-editor/tag-editor.tsx, frontend/app/element/property-editor/tag-editor.scss, frontend/app/element/property-editor/tag-editor.dom.test.tsx, frontend/app/view/aisessions/property/property-list.tsx, frontend/app/element/info-card/session-note-section.tsx, frontend/app/view/aisessions/aisessions.tsx, scripts/verify/agent-card-tags/**, scripts/verify/README.md, docs/project/verify-ledger.md, docs/project/ui-verify-playbook.md, .trellis/tasks/11-06-agent-card-tag-picker/**, .trellis/spec/**]
rollback: "git revert 单提交；optionCounts/tagCatalog 均为可选参数，回滚后候选项回到 def.options+已选值，无数据迁移、无 RPC 变更"
budget: {minutes: 150, retries: 2}
releaseCandidate: false
createdAt: "2026-11-06T05:27:52Z"
---

# Agent 卡片标签候选：全局清单 + 计数

## 背景

tags 编辑器已是共享 Wolai 浮层（element/property-editor/tag-editor.tsx），但候选项只含 def.options（= summary.tags）+ 本会话已选值，看不到别的会话用过的标签。全局清单与 count 后端已提供（Tags RPC → SessionTagSummary{tag,count}），前端只喂 aisessions 筛选面板。本次把清单上提到共享 store，编辑器加计数通道，候选三源合并。

## 来源

- self：nita 2026-11-06：标签支持展示现有所有标签并选择 + 候选显示数量

## 验收判据

- [ ] `npx vitest run frontend/app/view/aisessions/property` → `passed`
- [ ] `npx vitest run frontend/app/view/aisessions` → `passed`
- [ ] `npx vitest run frontend/app/element/property-editor` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=47`

## 记录

_（待补）_
