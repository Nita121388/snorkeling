---
id: N-1124-agentsend-false-fail
title: "Overview 发送已成功却显示发送失败（客户端超时预算 + 超时误映射 + 重复投递）"
type: bug
priority: P1
severity: S1
status: open
origin: internal
source: "2026-11-24T08:45:55Z"
task: 11-24-agentsend-false-fail
order: 100
touch: [frontend/app/session-overview/**, frontend/i18n/locales/**, scripts/verify/overview-board/**, docs/project/**, .trellis/**, loop/**]
rollback: null
budget: {minutes: 90, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T08:45:55Z"
---

# Overview 发送已成功却显示发送失败（客户端超时预算 + 超时误映射 + 重复投递）

## 背景

用户 2026-11-24 反馈：发送成功了但显示发送失败。根因已定位：客户端 RPC 超时 80s < 服务端最坏 270s（30s 安静等待 + 180s 提交确认 + 60s 等回复）；客户端超时错误 EC-TIME 被 outcomeFromSend 无条件判 failed，且草稿保留 → 用户点重试 = 重复投递。修法：超时预算覆盖服务端全预算 + 新增 unknown 行程态（禁止重试）+ 真失败仍可重试。

## 来源

- internal：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-card-send.test.ts && echo N1124_ST_OK` → `N1124_ST_OK`
- [ ] `npx eslint frontend/app/session-overview && echo N1124_LINT_OK` → `N1124_LINT_OK`

## 记录

_（待补）_
