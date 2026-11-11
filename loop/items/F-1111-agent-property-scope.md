---
id: F-1111-agent-property-scope
title: "Agent 卡片属性：范围三选一 + 表单美化 + 外部操作支持"
type: feature
priority: P1
status: open
origin: self
source: "2026-11-11T01:11:32Z"
task: 11-11-agent-property-scope
order: 100
touch: [pkg/wconfig/settingsconfig.go, pkg/agentdata/patch.go, pkg/wshrpc/wshrpctypes.go, pkg/agentcontrol/card.go, pkg/agentcontrol/card_schema.go, pkg/agentcontrol/card_schema_test.go, pkg/agentmcp/tools.go, cmd/wsh/cmd/wshcmd-agent-card.go, cmd/wsh/cmd/wshcmd-agent-card_test.go, frontend/types/gotypes.d.ts, frontend/app/view/aisessions/property/property-model.ts, frontend/app/view/aisessions/property/property-model.test.ts, frontend/app/view/aisessions/property/property-schema.ts, frontend/app/view/aisessions/property/property-list.tsx, frontend/app/view/aisessions/property/property-list.scss, frontend/app/view/aisessions/property/property-list.dom.test.tsx, frontend/app/element/info-card/session-note-section.tsx, frontend/app/element/info-card/session-note-section.test.tsx, scripts/verify/**, verify-runs/agent-property-scope/**, docs/project/agent-control-surface.md, docs/project/agent-data-patch.md, design/prototypes/agent/property-add-scope/**, .trellis/tasks/11-11-agent-property-scope/**, .trellis/spec/**, loop/items/F-1111-agent-property-scope.md, loop/gates.json, loop/REPORTS/**]
rollback: null
budget: {minutes: 240, retries: 2}
releaseCandidate: false
createdAt: "2026-11-11T01:11:32Z"
---

# Agent 卡片属性：范围三选一 + 表单美化 + 外部操作支持

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/view/aisessions/property` → `passed`
- [ ] `npx vitest run frontend/app/element/info-card` → `passed`
- [ ] `go test ./pkg/agentcontrol ./pkg/agentdata` → `ok`
- [ ] `npx tsc --noEmit -p tsconfig.json` → `47`

## 记录

_（待补）_
