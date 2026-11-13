---
id: F-1113-persona-widget-launch
title: "A3 widget 🎭 图标 + hover 登场弹窗 + 注入开关 + props.persona 派生补带"
type: feature
priority: P1
status: open
origin: self
source: "2026-11-13T01:32:06Z"
task: 11-12-persona-widget-launch
order: 100
touch: [pkg/service/aisessionsservice/**, pkg/persona/**, pkg/wconfig/defaultconfig/widgets.json, frontend/app/workspace/persona-launch.ts, frontend/app/workspace/persona-launch.test.ts, frontend/app/workspace/persona-launch-window.tsx, frontend/app/workspace/widgets.tsx, frontend/app/workspace/agent-launch.ts, frontend/app/store/services.ts, frontend/types/gotypes.d.ts, docs/project/persona-system.md, .trellis/tasks/11-12-persona-widget-launch/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 300, retries: 2}
releaseCandidate: false
createdAt: "2026-11-13T01:32:06Z"
---

# A3 widget 🎭 图标 + hover 登场弹窗 + 注入开关 + props.persona 派生补带

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `go test ./pkg/persona/... ./pkg/service/aisessionsservice/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `go test ./pkg/service/aisessionsservice/ -run TestDerivePersonaProps -v` → `PASS`
- [ ] `npx vitest run frontend/app/workspace/persona-launch` → `passed`
- [ ] `npx vitest run frontend/app/view/aisessions` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`
- [ ] `node -e "const w=require(""./pkg/wconfig/defaultconfig/widgets.json"");process.exit(w[""defwidget@persona""]?.icon===""masks-theater""?0:1)" && echo PERSONA_WIDGET_OK` → `PERSONA_WIDGET_OK`
- [ ] `grep -c "AgentPersonaIdMetaKey" frontend/app/workspace/persona-launch.ts` → `>=1`

## 记录

_（待补）_
