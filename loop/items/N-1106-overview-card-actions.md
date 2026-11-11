---
id: N-1106-overview-card-actions
title: "Overview 看板卡片动作：关闭 / 删除（含彻底删除）+ 内联 Tab 组不被误删"
type: feature
priority: P1
status: released
origin: self
source: "nita 2026-11-06 会话要求（先设计后开工）"
task: 11-06-overview-board-card-actions
order: 20
touch: [frontend/app/session-overview/**, frontend/app/modals/confirmmodal.tsx, frontend/app/modals/confirmmodal.test.tsx, pkg/aisessions/**, pkg/service/aisessionsservice/**, frontend/app/store/services.ts, frontend/types/gotypes.d.ts, scripts/verify/overview-board/**]
rollback: "git revert 前后端两次提交；硬删 RPC 可单独回滚，前端退回仅软删"
budget: {minutes: 180, retries: 2}
releaseCandidate: false
score: {value: 5, by: nita, at: "2026-11-08T13:17:04Z", note: null}
createdAt: "2026-11-06T00:45:53Z"
---

# Overview 看板卡片动作：关闭 / 删除（含彻底删除）+ 内联 Tab 组不被误删

## 背景

看板卡片目前只能打开会话详情，没有关闭/删除入口；关闭路径对 inline tab 组会连带删掉同组兄弟 block；删除只有移到 deleted 的软删，没有彻底删除。

## 来源

- self：nita 2026-11-06 会话要求（先设计后开工）

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/` → `60 passed`
- [ ] `npx vitest run frontend/app/modals/confirmmodal.test.tsx` → `6 passed`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". ./scripts/use-local-env.ps1 -Quiet; go test ./pkg/aisessions -run Delete"` → `ok`
- [ ] `node scripts/verify/overview-board/actions.mjs --attach` → `12/12`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `69`

## 记录

_（待补）_
