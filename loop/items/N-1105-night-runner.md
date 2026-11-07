---
id: N-1105-night-runner
title: "夜班真派发：headless agent 注入契约并限一包"
type: arch
priority: P1
status: open
origin: self
source: "2026-11-05T07:05:59Z"
task: 11-05-day-night-loop
order: 100
touch: [lib/**, bin/**, queue.mjs, RUNBOOK.md]
rollback: null
budget: {minutes: 120, retries: 1}
releaseCandidate: false
createdAt: "2026-11-05T07:05:59Z"
---

# 夜班真派发：headless agent 注入契约并限一包

## 背景

S3：把 queue run 从干跑推进到真起会话。契约与负向夹具已就绪（S1），取件入口已上线（S2）。

## 来源

- self：（待补）

## 验收判据

- [ ] `node --test lib/night.test.mjs` → `0 failed`

## 记录

_（待补）_
