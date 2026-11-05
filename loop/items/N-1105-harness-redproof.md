---
id: N-1105-harness-redproof
title: "既有 4 个 harness 登记 red_proof"
type: chore
priority: P1
status: open
origin: internal
source: "2026-11-05 昼夜循环工作流立项"
task: null
order: 20
touch: [loop/queue.json]
rollback: "git checkout -- loop/queue.json"
budget: {minutes: 45, retries: 1}
releaseCandidate: false
createdAt: "2026-11-05T09:40"
---

# 既有 4 个 harness 登记 red_proof

## 背景

现有四个 harness 只有“能跑绿”，没有“能对已知坏样本变红”的凭据。

## 来源

- internal：2026-11-05 昼夜循环工作流立项

## 验收判据

- [ ] `node loop/queue.mjs list --json` → `"pendingRedProof": 0`

## 记录

_（待补）_
