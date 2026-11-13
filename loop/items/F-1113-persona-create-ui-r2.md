---
id: F-1113-persona-create-ui-r2
title: "A2 创建向导：两步向导 + 三入口 + 同源文件树预览"
type: feature
priority: P1
status: open
origin: self
source: "2026-11-13T07:58:23Z"
task: 11-12-persona-create-ui
order: 150
touch: [pkg/service/aisessionsservice/**, frontend/app/view/persona/**, frontend/app/view/aisessions/**, frontend/app/modals/**, frontend/app/block/blockframe-header.tsx, frontend/app/store/services.ts, frontend/types/gotypes.d.ts, docs/project/persona-system.md, .trellis/tasks/11-12-persona-create-ui/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 300, retries: 2}
releaseCandidate: false
createdAt: "2026-11-13T07:58:23Z"
---

# A2 创建向导：两步向导 + 三入口 + 同源文件树预览

## 背景

A2 前端。承接 F-1113-persona-create-ui-r1（仅判据 6 的 grep 缺 -r 判红，实现已完成）。

## 来源

- self：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/view/persona frontend/app/view/aisessions` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`
- [ ] `go test ./pkg/persona/... ./pkg/service/aisessionsservice/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `grep PersonaCreateWizard frontend/app/view/persona/persona-create-wizard.tsx` → `PersonaCreateWizard`
- [ ] `grep "PersonaScaffoldPreview(request: AISessionsPersonaScaffoldPreviewRequest)" frontend/app/store/services.ts` → `PersonaScaffoldPreview(request: AISessionsPersonaScaffoldPreviewRequest)`
- [ ] `grep -rn persona-create-wizard frontend/app/view/aisessions/` → `persona-create-wizard`

## 记录

_（待补）_
