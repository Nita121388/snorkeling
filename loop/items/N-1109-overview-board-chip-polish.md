---
id: N-1109-overview-board-chip-polish
title: "Overview 看板 chip 美化（A：去描边胶囊化）"
type: redesign
priority: P2
status: open
origin: self
source: "nita 2026-11-09：.session-overview-board-chip 样式美化，选定 A 方向"
task: 11-09-overview-board-chip-polish
order: 100
touch: [frontend/app/session-overview/session-overview.scss, design/prototypes/overview-dashboard/board-chip-polish/**, design/prototypes/__INDEX__.md, .trellis/tasks/11-09-overview-board-chip-polish/**, loop/items/N-1109-overview-board-chip-polish.md, loop/red/N-1109-overview-board-chip-polish.txt, loop/gates.json]
rollback: "git checkout -- session-overview.scss 单文件；原型目录可整删"
budget: {minutes: 30, retries: 1}
releaseCandidate: false
createdAt: "2026-11-09T03:58:02Z"
---

# Overview 看板 chip 美化（A：去描边胶囊化）

## 背景

纯 CSS 微调：.session-overview-board-chip 去描边、999px 胶囊、10px 字号、文字提亮、内距 2px 8px；is-tag/tag-more 与状态 chip 语义不动。交付 before/after 可切换原型（G3），nita 自验观感（G7）。

## 来源

- self：nita 2026-11-09：.session-overview-board-chip 样式美化，选定 A 方向

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview --reporter=dot > nul 2>&1 && echo CHIP_SUITE=1` → `CHIP_SUITE=1`
- [ ] `git grep -c "padding: 1px 8px" -- frontend/app/session-overview/session-overview.scss` → `1`
- [ ] `git grep -c "board-chip-polish" -- design/prototypes/__INDEX__.md` → `1`

## 记录

- 红证：`loop/red/N-1109-overview-board-chip-polish.txt` —— 改 CSS 前探针 `CHIP_A_FORM=0`（exit 1）。
- 绿证：`git grep -c "padding: 1px 8px" ...` = 1；`git grep -c "board-chip-polish" __INDEX__` = 1；
  `npx vitest run frontend/app/session-overview` 全绿；`queue prove` 3/3。
- 原型：`design/prototypes/overview-dashboard/board-chip-polish/index.html`
  （before/after + 暗/亮/单色 + 实时宽高）；Edge headless 截图
  `verify-runs/proto-shots/board-chip-polish-light.png`，实测 BEFORE `54.1×16.6` →
  AFTER `62.6×16.5` px（高度差 0.1px）。
- 门：g2 红证、g5 合规已登记；g1/g3/g4/g7 等 nita 看原型签字（未跑真机，nita 自验）。
- 未提交：`session-overview.scss` 同文件混有 11-09-overview-card-metrics 的未提交 hunk，避免一锅端。
