---
id: N-1105-loop-ledger
title: "loop 台账骨架 + 门引擎"
type: arch
priority: P0
status: released
origin: internal
source: "2026-11-05 昼夜循环工作流立项"
task: 11-05-day-night-loop
order: 10
touch: [loop/**, .trellis/config.yaml]
rollback: "rm -rf loop/ && git checkout -- .trellis/config.yaml"
budget: {minutes: 90, retries: 2}
releaseCandidate: false
score: {value: 5, by: nita, at: "2026-11-08T13:16:00Z", note: null}
createdAt: "2026-11-05T09:40"
---

# loop 台账骨架 + 门引擎

## 背景

没有台账就没法回答“哪个班跑到哪、算不算过”，这是整套昼夜流程的地基。

## 来源

- internal：2026-11-05 昼夜循环工作流立项

## 验收判据

- [ ] `node --test loop/lib/` → `0 failed`
- [ ] `node loop/queue.mjs self-test` → `0 failed`
- [ ] `node loop/ledger.mjs self-test` → `0 failed`
- [ ] `node loop/queue.mjs verify-ledger` → `ledger ok`

## 记录

_（待补）_
