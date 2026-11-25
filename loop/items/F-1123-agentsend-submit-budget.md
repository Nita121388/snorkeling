---
id: F-1123-agentsend-submit-budget
title: "提交确认按时间预算退避（45s 次数上限绕过 180s/600s 预算）+ 派发回执不许掩盖未确认"
type: bug
priority: P0
severity: S1
status: open
origin: self
source: "2026-11-23 真机 verify 实测 retries=65 confirmed=false elapsedms=45526：MaxSubmitRetries=64x700ms 掐断 SubmitWaitMs 预算；另 dispatch 无条件 confirmed 并清空 Error"
task: 11-23-agentsend-submit-budget
order: 100
touch: [pkg/wshrpc/wshserver/agentsend.go, pkg/wshrpc/wshserver/agentdispatch_rpc.go, pkg/wshrpc/wshserver/submitbudget_test.go, pkg/agentdispatch/**, scripts/verify/commontext-create-send/**, scripts/verify/README.md, docs/project/verify-ledger.md, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 300, retries: 2}
releaseCandidate: false
createdAt: "2026-11-23T02:14:47Z"
feature: agentsend
---

# 提交确认按时间预算退避（45s 次数上限绕过 180s/600s 预算）+ 派发回执不许掩盖未确认

## 背景

_（待补）_

## 来源

- self：2026-11-23 真机 verify 实测 retries=65 confirmed=false elapsedms=45526：MaxSubmitRetries=64x700ms 掐断 SubmitWaitMs 预算；另 dispatch 无条件 confirmed 并清空 Error

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/wshrpc/wshserver -run 'SubmitRetryBudget|DispatchFinalState' -count=1"` → `ok`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/wshrpc/wshserver ./pkg/agentdispatch ./cmd/wsh/cmd -count=1"` → `ok`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go build ./...; if ($LASTEXITCODE -eq 0) { echo BUILD_OK }"` → `BUILD_OK`
- [ ] `cmd /c "findstr /C:\"manual\" docs\project
erify-ledger.md >nul && echo MANUAL_EVIDENCE_OK"` → `MANUAL_EVIDENCE_OK`

## 记录

_（待补）_
