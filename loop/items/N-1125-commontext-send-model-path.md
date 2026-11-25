---
id: N-1125-commontext-send-model-path
title: "CommonText 发送 Agent 模型与路径选择"
type: feature
priority: P1
status: open
origin: internal
source: "nita 2026-11-25：ok go，批准 commontext-send-agent-unify 原型转入实现"
task: 11-25-commontext-send-model-path
order: 100
touch: [frontend/app/commontext/commontext-send-button.tsx, frontend/app/commontext/commontext-send-existing.test.ts, frontend/app/commontext/commontext-send-create-path.test.ts, frontend/app/commontext/commontext-send-popover-geometry.dom.test.tsx, frontend/i18n/locales/zh/commontext.json, frontend/i18n/locales/en/commontext.json, scripts/verify/commontext-send-agent-block/verify.mjs, .trellis/tasks/11-25-commontext-send-model-path/**, .trellis/spec/snorkeling-docs/frontend/quality-guidelines.md, design/prototypes/commontext/commontext-send-agent-unify/**, docs/project/verify-ledger.md, loop/**]
rollback: null
budget: {minutes: 240, retries: 2}
releaseCandidate: false
createdAt: "2026-11-25T02:38:01Z"
feature: commontext-send
---

# CommonText 发送 Agent 模型与路径选择

## 背景

_（待补）_

## 来源

- internal：nita 2026-11-25：ok go，批准 commontext-send-agent-unify 原型转入实现

## 验收判据

- [ ] `npx vitest run frontend/app/commontext/commontext-send-existing.test.ts frontend/app/commontext/commontext-send-create-path.test.ts frontend/app/commontext/commontext-send-popover-geometry.dom.test.tsx && echo CT_SEND_UNIT_OK` → `CT_SEND_UNIT_OK`
- [ ] `node scripts/i18n/check-parity.mjs && echo CT_I18N_OK` → `CT_I18N_OK`
- [ ] `node scripts/verify/index.mjs --area commontext-send-agent-block && echo CT_SEND_VERIFY_OK` → `CT_SEND_VERIFY_OK`

## 记录

_（待补）_
