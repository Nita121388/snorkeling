---
id: F-1112-persona-core-r2
title: "A1 persona 核心：目录布局 + scaffold + wsh persona CLI"
type: feature
priority: P1
status: accepted
origin: self
source: "2026-11-12T11:35:10Z"
task: 11-12-persona-core
order: 100
touch: [pkg/persona/**, cmd/wsh/cmd/wshcmd-persona.go, .trellis/tasks/11-12-persona-core/**, .trellis/spec/**, loop/**, docs/project/persona-system.md]
rollback: null
budget: {minutes: 240, retries: 2}
releaseCandidate: false
score: {value: 4, by: nita, at: "2026-11-12T12:27:11Z", note: "用户 2026-11-12 会话明确授权代理验收。实现与判据一致；扣1分：block meta persona:<id> 重写与 data scope 强制点留 A3/A2.5 闭环。"}
createdAt: "2026-11-12T11:35:10Z"
---

# A1 persona 核心：目录布局 + scaffold + wsh persona CLI

## 背景

_（待补）_

## 来源

- self：（待补）

## 验收判据

- [ ] `go test ./pkg/persona/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `d=$(mktemp -d) && go run ./cmd/wsh persona create --name smoke --root "$d" --dry-run >/dev/null && test "$(find "$d" -type f | wc -l | tr -d " ")" = "0" && echo DRYRUN_NOWRITE_OK` → `DRYRUN_NOWRITE_OK`
- [ ] `d=$(mktemp -d) && go run ./cmd/wsh persona create --name smoke --root "$d" --yes >/dev/null && n=$(find "$d/smoke/.persona" -type f | wc -l | tr -d " ") && test "$n" -ge 9 && echo SCAFFOLD_GE9_OK` → `SCAFFOLD_GE9_OK`
- [ ] `d=$(mktemp -d) && go run ./cmd/wsh persona create --name smoke --root "$d" --yes >/dev/null && a=$(shasum -a 256 "$d/smoke/.persona/CHARTER.md" | cut -d" " -f1) && go run ./cmd/wsh persona create --name smoke --root "$d" --yes >/dev/null && b=$(shasum -a 256 "$d/smoke/.persona/CHARTER.md" | cut -d" " -f1) && test "$a" = "$b" && echo IDEMPOTENT_MD5_OK` → `IDEMPOTENT_MD5_OK`
- [ ] `d=$(mktemp -d) && go run ./cmd/wsh persona create --name smoke --root "$d" --yes >/dev/null && go run ./cmd/wsh persona rename smoke second --root "$d" --yes >/dev/null && test ! -e "$d/smoke" && test -e "$d/second/.persona/persona.json" && test "$(grep -c smoke "$d/.index/PERSONAS.md" || true)" = "0" && echo RENAME_OK` → `RENAME_OK`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`

## 记录

_（待补）_
