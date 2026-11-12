---
id: F-1112-persona-core
title: "A1 persona 核心：目录布局 + scaffold + wsh persona CLI"
type: feature
priority: P1
status: open
origin: self
source: "2026-11-12T11:28:20Z"
task: 11-12-persona-core
order: 100
touch: [pkg/persona/**, cmd/wsh/cmd/wshcmd-persona.go, .trellis/tasks/11-12-persona-core/**, .trellis/spec/**, loop/**, docs/project/persona-system.md]
rollback: null
budget: {minutes: 240, retries: 2}
releaseCandidate: false
createdAt: "2026-11-12T11:28:20Z"
---

# A1 persona 核心：目录布局 + scaffold + wsh persona CLI

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `go test ./pkg/persona/...` → `ok`
- [ ] `go build ./cmd/wsh/` → `ok`
- [ ] `wsh persona create --name smoke --root <tmproot> --dry-run && find <tmproot> -type f | wc -l` → `0`
- [ ] `wsh persona create --name smoke --root <tmproot> --yes && find <tmproot>/smoke/.persona -type f | wc -l` → `>=9`
- [ ] `wsh persona create --name smoke --root <tmproot> --yes (2nd run) && md5 <tmproot>/smoke/.persona/CHARTER.md unchanged` → `unchanged`
- [ ] `wsh persona rename smoke smoke2 --root <tmproot> --yes && test ! -e <tmproot>/smoke && grep -c "smoke " <tmproot>/.index/PERSONAS.md` → `0`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=47`

## 记录

_（待补）_
