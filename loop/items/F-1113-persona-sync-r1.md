---
id: F-1113-persona-sync-r1
title: "A5 跨机同步 v1：rootdir 单仓 + gitignore + rebuild + journal 冲突合并"
type: feature
priority: P1
status: accepted
origin: self
source: "2026-11-13T03:35:43Z"
task: 11-12-persona-sync
order: 110
touch: [pkg/persona/**, cmd/wsh/cmd/wshcmd-persona.go, pkg/agentguide/**, pkg/agentskill/content/**, docs/project/persona-system.md, .trellis/tasks/11-12-persona-sync/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 240, retries: 2}
releaseCandidate: false
score: {value: 4, by: nita, at: "2026-11-13T03:46:45Z", note: "用户 2026-11-13 会话原话授权代理验收「继续开发直到完成」；真机验证按用户要求留手动。7/7 判据机器采数全绿，双 clone 真 git 往返通过。commit 见 git log。"}
createdAt: "2026-11-13T03:35:43Z"
---

# A5 跨机同步 v1：rootdir 单仓 + gitignore + rebuild + journal 冲突合并

## 背景

用户 2026-11-13 会话授权继续开发；真机验证留用户手动，判据全部纯机器可判定。

## 来源

- self：（待补）

## 验收判据

- [ ] `go test ./pkg/persona/... ./pkg/service/aisessionsservice/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `go test ./pkg/persona/ -run TestSync -v` → `PASS`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`
- [ ] `grep SyncModeShared pkg/persona/sync.go` → `SyncModeShared`
- [ ] `grep personaSyncCmd cmd/wsh/cmd/wshcmd-persona.go` → `personaSyncCmd`
- [ ] `go test ./pkg/persona/ -run TestSyncJournalConflict -v` → `PASS`

## 记录

_（待补）_
