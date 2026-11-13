---
id: F-1113-persona-create-ui-r1
title: "A2 创建向导：两步向导 + 三入口 + 同源文件树预览"
type: feature
priority: P1
status: open
origin: self
source: "2026-11-13T05:15:20Z"
task: 11-12-persona-create-ui
order: 150
touch: [pkg/service/aisessionsservice/**, frontend/app/view/persona/**, frontend/app/view/aisessions/**, frontend/app/store/services.ts, frontend/types/gotypes.d.ts, docs/project/persona-system.md, .trellis/tasks/11-12-persona-create-ui/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 300, retries: 2}
releaseCandidate: false
createdAt: "2026-11-13T05:15:20Z"
---

# A2 创建向导：两步向导 + 三入口 + 同源文件树预览

## 背景

用户 2026-11-13 授权继续开发；真机验证留用户手动。

## 来源

- self：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/view/persona frontend/app/view/aisessions` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`
- [ ] `go test ./pkg/persona/... ./pkg/service/aisessionsservice/...` → `ok`
- [ ] `grep PersonaCreateWizard frontend/app/view/persona/persona-create-wizard.tsx` → `PersonaCreateWizard`
- [ ] `grep "PersonaScaffoldPreview(request: AISessionsPersonaScaffoldPreviewRequest)" frontend/app/store/services.ts` → `PersonaScaffoldPreview(request: AISessionsPersonaScaffoldPreviewRequest)`
- [ ] `grep persona-create-wizard frontend/app/view/aisessions/` → `persona-create-wizard`

## 记录

_（待补）_
