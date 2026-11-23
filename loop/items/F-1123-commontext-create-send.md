---
id: F-1123-commontext-create-send
title: "CommonText 新建 agent 发送丢失：create 路径改走后端 agentsend（提交确认+补回车）"
type: bug
priority: P0
severity: S1
status: open
origin: self
source: "nita 2026-11-23：在 CommonText 编辑并发送的文本没有发送出去（create 路径走前端 pending-input paste + 固定延迟回车，pi 启动期吞回车）"
task: 11-23-commontext-create-send
order: 100
touch: [frontend/app/commontext/commontext-send-button.tsx, frontend/app/commontext/commontext-send-create-path.test.ts, frontend/i18n/locales/**, scripts/verify/commontext-create-send/**, scripts/verify/README.md, docs/project/verify-ledger.md, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 240, retries: 2}
releaseCandidate: false
createdAt: "2026-11-23T00:58:27Z"
---

# CommonText 新建 agent 发送丢失：create 路径改走后端 agentsend（提交确认+补回车）

## 背景

_（待补）_

## 来源

- self：nita 2026-11-23：在 CommonText 编辑并发送的文本没有发送出去（create 路径走前端 pending-input paste + 固定延迟回车，pi 启动期吞回车）

## 验收判据

- [ ] `npx vitest run frontend/app/commontext/commontext-send-create-path.test.ts` → `3 passed`
- [ ] `npx vitest run frontend/app/commontext` → `Tests` 全 passed
- [ ] `cmd /c "findstr /C:\"manual\" docs\project
erify-ledger.md >nul && echo MANUAL_EVIDENCE_OK"` → `MANUAL_EVIDENCE_OK`
- [ ] `cmd /c "node scripts/i18n/check-parity.mjs >nul 2>&1 && echo PARITY_OK"` → `PARITY_OK`

_（待补）_

## 记录

_（待补）_
