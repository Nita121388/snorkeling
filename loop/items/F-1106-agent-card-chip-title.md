---
id: F-1106-agent-card-chip-title
title: "Agent 卡片统一：状态 chip 收口 + 运行时长 + 标题编辑"
type: feature
priority: P1
status: open
origin: self
source: "nita 2026-11-06 会话要求（先设计后开工）"
task: 11-06-agent-card-chip-title
order: 30
touch: [frontend/app/agent-status/**, frontend/app/session-overview/**, frontend/app/element/info-card/**, frontend/app/view/term/agent-hover-card.tsx, frontend/app/view/term/term-model.ts, frontend/app/view/aisessions/title-edit.ts, frontend/app/view/aisessions/session-detail.tsx, frontend/app/modals/agentcardmodal.tsx, frontend/app/store/session-note-hook.ts, scripts/verify/agent-card-seen/**, docs/project/verify-ledger.md, docs/project/agent-card-layout.md]
rollback: "三次独立 commit 逐个 revert；chip-view / runtime / second-tick 均为纯新增模块，删掉即回旧行为"
budget: {minutes: 180, retries: 2}
releaseCandidate: false
createdAt: "2026-11-06T06:00:27Z"
---

# Agent 卡片统一：状态 chip 收口 + 运行时长 + 标题编辑

## 背景

Agent 状态徽章在仓库里有 4 份互不相干的实现（Overview 列表/看板 `agent-status-chip.tsx`、悬浮卡+放大弹窗
`.agent-card-status-chip`、Tab 聚合 `AggregateStatusChip`、Block 头部 `HeaderElem` 文本），
只有判定层（`deriveAgentStatusView`）是共享的，几何与排版各写一份。

后果可见：

- 悬浮卡的状态徽章文字垂直不居中（20px/10.5px 与共享的 18px/10px 是两套光学参数）
- 运行时长只有 Overview 列表/看板显示，悬浮卡与头部只在「未读 Done」时显示 elapsed
- 放大弹窗与悬浮卡都不能编辑会话标题（`agentcardmodal.tsx` 只把标题当纯文本塞进 `Modal title`）

## 来源

- self：nita 2026-11-06 会话要求 —— "agent 的状态 chip 能否支持显示运行时间，会不会很影响性能"
  → "agent card 点击放大打开的弹窗应该支持编辑标题，这个 chip 需要统一为一个组件"

## 验收判据

- [ ] `npx vitest run frontend/app/agent-status/` → `260 passed`（基线 224 + 新增 36：chip-view 22 + runtime 13 + 头部契约 1）
- [ ] `npx vitest run frontend/app/view/term/` → `196 passed`（基线 186 + 新增 10：term-agent-status-header）
- [ ] `npx vitest run frontend/app/store/` → `100 passed`（基线 86 + 新增 14：renameTitle）
- [ ] `npx vitest run frontend/app/element/info-card/` → `53 passed`（基线 36 + 新增 17：editable-title）
- [ ] `npx vitest run frontend/app/session-overview/` → `140 passed`（不降；chip 测试放在 agent-status）
- [ ] `npx vitest run frontend/app/modals/` → `39 passed`（不降）
- [ ] `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `47`
      （本包链路 0 新增错误；仓库当前 48 的差额来自他人未跟踪探针 `frontend/tt-probe.ts`）
- [ ] `node scripts/verify/agent-card-seen/verify.mjs` → `25/25`（基线 21 + 新增 4）
- [ ] `node scripts/verify/overview-board/verify.mjs` → `38/38`

新增判据必须能看见本包的缺陷：

- chip 收口：4 个 variant 对同一 `status` 产出相同 `label`；旧实现下悬浮卡根本不产出跑时文本 → 红
- 跑时：`formatAgentChipRuntime(201000, 0)` 类纯函数用例；`working` 态 `runtime !== ""`、`idle` 态 `=== ""`
- 垂直居中：`|chipLabelRect.centerY − chipRect.centerY| <= 1`，对修复前的 20px/10.5px 悬浮卡必须红
- 标题编辑：改名后 chip 呈现态**不是** `done`（R4 回归锁，防 `SetTitle` bump `UpdatedAt` 误点亮 Done）

## 记录

_（待补）_
