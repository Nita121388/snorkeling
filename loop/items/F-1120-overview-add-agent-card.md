---
id: F-1120-overview-add-agent-card
title: "Overview 看板 Tab 下新建 Agent 卡（＋ 入口 + New Agent 同款居中弹窗）"
type: redesign
priority: P1
status: open
origin: self
source: "nita 2026-11-20 布置：Overview 看板按 Tab 分组时，每个 Tab 列底部「＋ 新建」，弹 New Agent 同款居中弹窗，选 agent + 模型 + 路径（随 Tab），建块进该 Tab"
task: 11-20-f-1120-overview-add-agent-card
order: 100
touch: [frontend/app/session-overview/overview-add-agent.ts, frontend/app/session-overview/overview-add-agent.test.ts, frontend/app/session-overview/overview-add-agent-modal.tsx, frontend/app/session-overview/overview-add-agent-modal.dom.test.tsx, frontend/app/session-overview/overview-board.tsx, frontend/app/session-overview/overview-board-model.ts, frontend/app/session-overview/overview-board-add.test.tsx, frontend/app/session-overview/session-overview.tsx, frontend/app/session-overview/session-overview.scss, frontend/i18n/locales/en/session-overview.json, frontend/i18n/locales/zh/session-overview.json, design/prototypes/overview-dashboard/overview-add-agent-card/**, .trellis/tasks/11-20-f-1120-overview-add-agent-card/**, loop/items/F-1120-overview-add-agent-card.md, loop/red/F-1120-overview-add-agent-card.txt, loop/gates.json, docs/project/**]
rollback: null
budget: {minutes: 300, retries: 2}
releaseCandidate: false
createdAt: "2026-11-20T03:16:03Z"
---

# Overview 看板 Tab 下新建 Agent 卡（＋ 入口 + New Agent 同款居中弹窗）

## 背景

Overview 看板目前是纯只读投影：卡片只能来自已存在的 agent 块，没有任何新建入口。用户要按 Tab 组织工作时，必须先去该 Tab 开 agent 块再回看板。本次把「新建 agent 会话」入口放到 Tab 列底部，路径/连接继承该 Tab，避免上下文串台。

## 来源

- self：nita 2026-11-20 布置：Overview 看板按 Tab 分组时，每个 Tab 列底部「＋ 新建」，弹 New Agent 同款居中弹窗，选 agent + 模型 + 路径（随 Tab），建块进该 Tab

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-add-agent.test.ts` → `passed`
- [ ] `npx vitest run frontend/app/session-overview/overview-add-agent-modal.dom.test.tsx` → `passed`
- [ ] `npx vitest run frontend/app/session-overview/overview-board-add.test.tsx` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "overview-add-agent"` → `0`
- [ ] `npx eslint frontend/app/session-overview/overview-add-agent.ts frontend/app/session-overview/overview-add-agent-modal.tsx frontend/app/session-overview/overview-board.tsx frontend/app/session-overview/session-overview.tsx` → `0`

## 记录

_（待补）_
