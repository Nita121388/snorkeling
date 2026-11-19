---
id: N-1119-agent-card-display
title: "Agent 卡片：模型新鲜度与供应商拆分 + 标题来源短标记"
type: bug
priority: P1
severity: S3
status: open
origin: self
source: "nita 2026-11-19：agent card 模型展示滞后/供应商未拆分；标题来源显示 First User Message 长串"
task: 11-19-agent-card-model-title-display
order: 100
touch: [pkg/aisessions/types.go, pkg/aisessions/manager.go, pkg/aisessions/provider_pi.go, pkg/aisessions/provider_codex.go, pkg/aisessions/provider_pi_test.go, pkg/aisessions/provider_codex_test.go, pkg/service/aisessionsservice/chatcontrol.go, pkg/service/aisessionsservice/chatcontrol_test.go, frontend/app/view/term/agent-identity.ts, frontend/app/view/term/agent-identity.test.ts, frontend/app/view/term/agent-hover-card.tsx, frontend/app/view/term/agent-card-title-source-mark.tsx, frontend/app/view/term/agent-card-title-source-mark.test.tsx, frontend/app/agent-status/agent-runtime-metadata-store.ts, frontend/app/agent-status/agent-runtime-metadata-store.test.ts, frontend/app/tab/tab-more-agent-card.tsx, frontend/app/tab/tab-more-agent-card.test.tsx, frontend/i18n/locales/zh/term.json, frontend/i18n/locales/en/term.json, scripts/verify/agent-card-model/**, scripts/verify/README.md, docs/project/verify-ledger.md, loop/red/N-1119-agent-card-display.txt, .trellis/tasks/11-19-agent-card-model-title-display/**, .trellis/tasks/11-19-agent-card-model-provider/**, .trellis/tasks/11-19-agent-card-title-source-marker/**]
rollback: null
budget: {minutes: 240, retries: 2}
releaseCandidate: false
createdAt: "2026-11-19T06:16:03Z"
---

# Agent 卡片：模型新鲜度与供应商拆分 + 标题来源短标记

## 背景

_（待补）_

## 来源

- self：nita 2026-11-19：agent card 模型展示滞后/供应商未拆分；标题来源显示 First User Message 长串

## 验收判据

- [ ] `node scripts/verify/agent-card-model/verify.mjs` → `12/12 PASS`
- [ ] `npx vitest run frontend/app/view/term/ frontend/app/agent-status/ frontend/app/tab/ && echo VITEST_OK` → `VITEST_OK`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/ ./pkg/service/aisessionsservice/ -run 'TestPiCurrentModelState|TestCodexCurrentModelState|TestLiveSessionStateCurrentModel|TestCurrentModelStateDoesNotLoadMessages|TestCurrentModelStateBudget|TestCurrentModelStateSkipsOversizedLine' -v; if ($LASTEXITCODE -eq 0) { Write-Output GO_OK }"` → `GO_OK`
- [ ] `npm run i18n:check && echo I18N_OK` → `I18N_OK`
- [ ] `node scripts/check-tsc-baseline.mjs` → `<=47`

## 记录

_（待补）_
