---
id: N-1105-queue-failopen
title: "queue.json 解析失败不再静默清空（回退 last-good 快照）"
type: bug
priority: P2
status: open
origin: internal
source: "2026-11-05 昼夜循环工作流立项"
task: null
order: 15
touch: [loop/**]
rollback: "git checkout 37db7b96 -- loop/queue.mjs && rm -f loop/lib/queue-io*.mjs"
budget: {minutes: 40, retries: 2}
releaseCandidate: false
createdAt: 2026-11-05T02:16:05Z
---

# queue.json 解析失败不再静默清空（回退 last-good 快照）

## 背景

queue.json 解析失败返回空队列，等于夜间队列被静默清空。

## 来源

- internal：2026-11-05 昼夜循环工作流立项

## 验收判据

- [ ] `node --test loop/lib/queue-io.test.mjs` → `5 passed, 0 failed`
- [ ] `node --test "loop/lib/*.test.mjs"` → `67 passed, 0 failed`

## 记录

_（待补）_
