---
id: F-1113-persona-roster-r1
title: "A4 人设名册 Block persona://（列表/详情 + 登场复用）"
type: feature
priority: P1
status: open
origin: self
source: "2026-11-13T04:50:14Z"
task: 11-12-persona-roster-block
order: 140
touch: [pkg/service/aisessionsservice/**, frontend/app/view/persona/**, frontend/app/workspace/widgets.tsx, frontend/app/workspace/persona-launch.ts, frontend/app/store/services.ts, frontend/types/gotypes.d.ts, docs/project/persona-system.md, .trellis/tasks/11-12-persona-roster-block/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 300, retries: 2}
releaseCandidate: false
createdAt: "2026-11-13T04:50:14Z"
---

# A4 人设名册 Block persona://（列表/详情 + 登场复用）

## 背景

用户 2026-11-13 授权继续开发；真机验证留用户手动。

## 来源

- self：（待补）

## 验收判据

- [ ] `go test ./pkg/persona/... ./pkg/service/aisessionsservice/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `npx vitest run frontend/app/view/persona` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`
- [ ] `grep PersonaViewModel frontend/app/view/persona/persona.tsx` → `PersonaViewModel`
- [ ] `grep "PersonaOverview(request: AISessionsPersonaOverviewRequest)" frontend/app/store/services.ts` → `PersonaOverview(request: AISessionsPersonaOverviewRequest)`

## 记录

_（待补）_
