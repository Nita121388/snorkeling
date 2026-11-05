---
id: N-1105-cleanup-46to22
title: "清账：活跃任务 46 → ≤22（归档清单须人工过）"
type: arch
priority: P1
status: open
origin: internal
source: "2026-11-05 昼夜循环工作流立项"
task: null
order: 30
touch: [.trellis/tasks/**, loop/queue.json]
rollback: "python .trellis/scripts/task.py list-archive <月> 后逐个还原目录"
budget: {minutes: 120, retries: 0}
releaseCandidate: false
createdAt: 2026-11-05T09:40
---

# 清账：活跃任务 46 → ≤22（归档清单须人工过）

## 背景

46 个活跃任务里约一半已落地未归档，队列噪声比真实待办大两倍。

## 来源

- internal：2026-11-05 昼夜循环工作流立项

## 验收判据

- [ ] `python .trellis/scripts/task.py list | grep -c '^\s*-'` → `<=22`

## 记录

_（待补）_
