---
id: N-1127-perf-vcs-git-fanout
title: "Wave 3-1e: VCS 单仓 5-8 次串行 git 进程 + .git 内试探 svn info → 合并 porcelain=2 --branch + 并发池 + 跳过 svn"
type: bug
priority: P2
severity: S2
status: open
origin: self
source: "HANDOFF.md 遗留 follow-up 3"
task: null
order: 100
touch: [pkg/wshrpc/wshremote/vcs.go, pkg/wshrpc/wshremote/vcs_fanout_test.go]
rollback: null
budget: {minutes: 120}
releaseCandidate: false
createdAt: "2026-11-27T01:25:18Z"
---

# Wave 3-1e: VCS 单仓 5-8 次串行 git 进程 + .git 内试探 svn info → 合并 porcelain=2 --branch + 并发池 + 跳过 svn

## 背景

_（待补）_

## 来源

- self：HANDOFF.md 遗留 follow-up 3

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test -p 1 ./pkg/wshrpc/wshremote" && echo VCS_FANOUT_OK` → `VCS_FANOUT_OK`

## 记录

_（待补）_
