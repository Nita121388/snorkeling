---
id: F-1113-persona-journal-r1
title: "A6 journal 写入器 + 提议制记忆 + 蒸馏（含回滚）"
type: feature
priority: P1
status: open
origin: self
source: "2026-11-13T03:48:30Z"
task: 11-12-persona-journal
order: 120
touch: [pkg/persona/**, cmd/wsh/cmd/wshcmd-persona.go, pkg/agentguide/**, pkg/agentskill/content/**, docs/project/persona-system.md, .trellis/tasks/11-12-persona-journal/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 240, retries: 2}
releaseCandidate: false
createdAt: "2026-11-13T03:48:30Z"
---

# A6 journal 写入器 + 提议制记忆 + 蒸馏（含回滚）

## 背景

用户 2026-11-13 授权继续开发；真机验证留用户手动。

## 来源

- self：（待补）

## 验收判据

- [ ] `go test ./pkg/persona/... ./pkg/service/aisessionsservice/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `go test ./pkg/persona/ -run TestJournal -v` → `PASS`
- [ ] `go test ./pkg/persona/ -run TestInbox -v` → `PASS`
- [ ] `go test ./pkg/persona/ -run TestDistill -v` → `PASS`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`
- [ ] `grep personaJournalCmd cmd/wsh/cmd/wshcmd-persona.go` → `personaJournalCmd`

## 记录

_（待补）_
