---
id: F-1112-persona-aisessions-r1
title: "A1.5 AISessions 集成：persona 属性 + 🎭 分组折叠 + 登场史"
type: feature
priority: P1
status: accepted
origin: self
source: "2026-11-12T12:16:00Z"
task: 11-12-persona-aisessions
order: 100
touch: [pkg/service/aisessionsservice/**, pkg/persona/**, frontend/types/gotypes.d.ts, frontend/app/view/aisessions/**, docs/project/persona-system.md, .trellis/tasks/11-12-persona-aisessions/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 300, retries: 2}
releaseCandidate: false
score: {value: 4, by: nita, at: "2026-11-12T14:46:22Z", note: "用户 2026-11-12 会话明确授权代理验收。4/4 判据绿（vitest 570）；AC3 props.persona 活体验证留 A3 登场管线闭环。"}
createdAt: "2026-11-12T12:16:00Z"
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
