---
id: F-1112-persona-agent-create
title: "A2.5 Agent 自创建：CLI + propose 闸门 + 配额 + memory 纪律"
type: feature
priority: P1
status: open
origin: self
source: "2026-11-12T12:13:15Z"
task: 11-12-persona-agent-create
order: 100
touch: [pkg/persona/**, cmd/wsh/cmd/wshcmd-persona.go, pkg/agentguide/**, pkg/agentskill/**, .trellis/tasks/11-12-persona-agent-create/**, .trellis/spec/**, docs/project/persona-system.md, loop/**]
rollback: null
budget: {minutes: 300, retries: 2}
releaseCandidate: false
createdAt: "2026-11-12T12:13:15Z"
---

# A2.5 Agent 自创建：CLI + propose 闸门 + 配额 + memory 纪律

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `go test ./pkg/persona/... ./pkg/agentguide/... ./pkg/agentskill/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `d=$(mktemp -d) && go run ./cmd/wsh persona create --root "$d" --name p1 --from-session s1 >/dev/null && test -e "$d/.index/proposals/p1.json" && test ! -e "$d/p1" && echo PROPOSE_OK` → `PROPOSE_OK`
- [ ] `d=$(mktemp -d) && go run ./cmd/wsh persona create --root "$d" --name p1 --from-session s1 >/dev/null && go run ./cmd/wsh persona create --root "$d" --name p2 --from-session s1 >/dev/null && ! go run ./cmd/wsh persona create --root "$d" --name p3 --from-session s1 >/dev/null 2>&1 && test ! -e "$d/.index/proposals/p3.json" && echo QUOTA_OK` → `QUOTA_OK`
- [ ] `d=$(mktemp -d) && go run ./cmd/wsh persona create --root "$d" --name smoke --yes >/dev/null && ! go run ./cmd/wsh persona memory add smoke --section lessons --text lessonx --root "$d" --yes >/dev/null 2>&1 && grep -q lessonx "$d/smoke/.persona/MEMORY/inbox.md" && echo MEMORY_DISCIPLINE_OK` → `MEMORY_DISCIPLINE_OK`
- [ ] `d=$(mktemp -d) && go run ./cmd/wsh persona create --root "$d" --name smoke --yes >/dev/null && go run ./cmd/wsh persona memory add smoke --section journal --text jrun1 --root "$d" --yes >/dev/null && grep -q jrun1 "$d/smoke/.persona/MEMORY/journal.md" && echo JOURNAL_OK` → `JOURNAL_OK`
- [ ] `n=$(go run ./cmd/wsh agent guide --json | grep -o '"cmd": "persona[^"]*"' | wc -l | tr -d " ") && test "$n" -ge 3 && echo GUIDE_PERSONA_OK` → `GUIDE_PERSONA_OK`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`

## 记录

_（待补）_
