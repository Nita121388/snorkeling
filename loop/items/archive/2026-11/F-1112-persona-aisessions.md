---
id: F-1112-persona-aisessions
title: "A1.5 AISessions 集成：persona 属性 + 🎭 分组折叠 + 登场史"
type: feature
priority: P1
status: open
origin: self
source: "2026-11-12T12:05:01Z"
task: 11-12-persona-aisessions
order: 100
touch: [pkg/service/aisessionsservice/**, pkg/persona/**, frontend/types/gotypes.d.ts, frontend/app/view/aisessions/**, docs/project/persona-system.md, .trellis/tasks/11-12-persona-aisessions/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 300, retries: 2}
releaseCandidate: false
createdAt: "2026-11-12T12:05:01Z"
---

# A1.5 AISessions 集成：persona 属性 + 🎭 分组折叠 + 登场史

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/view/aisessions` → `passed`
- [ ] `go test ./pkg/service/aisessionsservice/... ./pkg/persona/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`

## 记录

_（待补）_
