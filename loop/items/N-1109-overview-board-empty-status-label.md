---
id: N-1109-overview-board-empty-status-label
title: "Overview 看板：无状态 agent 卡渲染空状态标签"
type: bug
priority: P2
status: open
origin: self
source: "nita 2026-11-09 报：pi agent 卡片出现 <span class=\"session-overview-board-card-view-label\"></span>"
task: 11-09-overview-board-empty-status-label
order: 100
touch: [frontend/app/session-overview/overview-board-model.ts, frontend/app/session-overview/overview-board.tsx, frontend/app/session-overview/overview-board.test.ts, frontend/app/session-overview/overview-board-empty-label.test.tsx, scripts/verify/overview-board/verify.mjs, docs/project/verify-ledger.md, .trellis/tasks/11-09-overview-board-empty-status-label/**, .trellis/spec/**, loop/items/N-1109-overview-board-empty-status-label.md, loop/red/N-1109-overview-board-empty-status-label.txt, loop/gates.json]
rollback: "git revert 单提交；无数据/接口/存储变更"
budget: {minutes: 45, retries: 2}
releaseCandidate: false
createdAt: "2026-11-09T03:31:25Z"
---

# Overview 看板：无状态 agent 卡渲染空状态标签

## 背景

看板卡片在 status == null 时无条件渲染兜底 view-label，而 agent-like 卡的 kindLabel 恒为空串；该 span 带 border/padding，于是画出空胶囊。列表视图已经按 status 判空，本包把同一收口补到看板。

## 来源

- self：nita 2026-11-09 报：pi agent 卡片出现 <span class="session-overview-board-card-view-label"></span>

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-board.test.ts frontend/app/session-overview/overview-board-empty-label.test.tsx --reporter=dot > nul 2>&1 && echo EMPTY_LABEL_UNIT=1` → `EMPTY_LABEL_UNIT=1`
- [ ] `npx vitest run frontend/app/session-overview --reporter=dot > nul 2>&1 && echo OVERVIEW_SUITE=1` → `OVERVIEW_SUITE=1`
- [ ] `git grep -c "resolveBoardMetaLabel({" -- frontend/app/session-overview/overview-board.tsx` → `1`

## 记录

- 2026-11-09：nita 明示「不用真机验证，我自己验证」。本包不启动 Electron/CDP；
  `scripts/verify/overview-board/verify.mjs` 的 `board-no-empty-view-label` 与
  `board-view-labels-preserved` 两条断言保留给用户自验，
  `docs/project/verify-ledger.md` 记 `skipped（用户自验）`，不写假绿。
- 红证：`loop/red/N-1109-overview-board-empty-status-label.txt` —— 修复前
  `BAD_FALLBACK=1`（exit 1）+ vitest `2 failed / 6 failed / 56 passed`
  （信号 `resolveBoardMetaLabel is not a function`、DOM 用例失败）。
- 绿证：同一 vitest `2 passed / 64 passed / 0 failed`（复核后补 2 个 DOM 用例，
  覆盖「有状态 chip」与「有状态但无 ack 回调」）；CDP 台补 `board-view-labels-preserved`
  锁住非 agent 卡标签不消失；`queue prove` 3/3 判据全绿；静态探针 `BAD_FALLBACK=0`；
  `npx tsc --noEmit` 的 `error TS=47`（等于既有基线，四个改动文件 0 error）。G7 仍待人验收。
