---
id: F-1113-persona-relocate-r1
title: "A5.5 rootdir 设置 + relocate + journal 轮转 + 容量三项"
type: feature
priority: P1
status: accepted
origin: self
source: "2026-11-13T04:37:19Z"
task: 11-12-persona-relocate
order: 130
touch: [pkg/persona/**, pkg/wconfig/**, pkg/service/aisessionsservice/**, cmd/wsh/cmd/wshcmd-persona.go, frontend/app/view/waveconfig/**, frontend/types/gotypes.d.ts, docs/project/persona-system.md, .trellis/tasks/11-12-persona-relocate/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 300, retries: 2}
releaseCandidate: false
score: {value: 4, by: nita, at: "2026-11-13T04:48:37Z", note: "用户 2026-11-13 会话原话授权代理验收「继续开发直到完成」；真机验证留用户手动。9/9 判据机器采数全绿；白名单生成物偏差已披露（metaconsts/schema 由 settings 键再生成）。"}
createdAt: "2026-11-13T04:37:19Z"
---

# A5.5 rootdir 设置 + relocate + journal 轮转 + 容量三项

## 背景

用户 2026-11-13 授权继续开发；真机验证留用户手动。

## 来源

- self：（待补）

## 验收判据

- [ ] `go test ./pkg/persona/... ./pkg/service/aisessionsservice/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `go test ./pkg/persona/ -run TestRelocate -v` → `PASS`
- [ ] `go test ./pkg/persona/ -run TestRotateJournal -v` → `PASS`
- [ ] `npx vitest run frontend/app/view/waveconfig` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`
- [ ] `grep personaRelocateCmd cmd/wsh/cmd/wshcmd-persona.go` → `personaRelocateCmd`
- [ ] `grep persona:rootdir pkg/wconfig/settingsconfig.go` → `persona:rootdir`
- [ ] `grep PersonaSettingsContent frontend/app/view/waveconfig/waveconfig-model.ts` → `PersonaSettingsContent`

## 记录

_（待补）_
