---
id: F-1117-overview-card-props
title: "Overview agent 卡面显示 Note/Tags/自定义属性（含状态）"
type: feature
priority: P1
status: open
origin: internal
source: "2026-11-17T07:43:27Z"
task: 11-17-overview-agent-card-props
order: 100
touch: [frontend/app/session-overview/overview-board-model.ts, frontend/app/session-overview/overview-board-model.test.ts, frontend/app/session-overview/overview-board.tsx, frontend/app/session-overview/overview-board-memo.test.tsx, frontend/app/session-overview/session-overview.tsx, frontend/app/session-overview/session-overview.scss, frontend/app/element/info-card/session-note-section.tsx, frontend/i18n/locales/en/session-overview.json, frontend/i18n/locales/zh/session-overview.json, frontend/i18n/locales/en/element.json, frontend/i18n/locales/zh/element.json, scripts/verify/overview-board/**, scripts/verify/README.md, docs/project/verify-ledger.md, .trellis/tasks/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 90, retries: 1}
releaseCandidate: false
createdAt: "2026-11-17T07:43:27Z"
feature: overview-board
---

# Overview agent 卡面显示 Note/Tags/自定义属性（含状态）

## 背景

Overview 列表行与看板卡此前不读 `summary.props`（用户自定义属性，如 status），列表行也无 tags。数据层完整（`Summary` RPC 返回 note/tags/props），纯渲染层缺口。方案要点：看板卡 props 彩色胶囊（status/select 类型）+ 上限 3 条 + `+n` 溢出防卡高跳动；列表行补 tags chips + 属性紧凑行；悬浮卡 `summary == null` 渲染加载占位。全部复用现有 summary 缓存，不加新 RPC；解析逻辑收口 `overview-board-model.ts` 纯函数（`resolveBoardPropRows`）。完整需求见 `.trellis/tasks/11-17-overview-agent-card-props/prd.md`（G1 已签：2026-11-17 @nita）。

## 来源

- internal：2026-11-17 白天 nita 口头需求（Overview 卡面显示 Note/Tags/自定义属性），同日建任务与包。

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-board-model.test.ts` → `passed`
- [ ] `npx vitest run frontend/app/session-overview frontend/app/element/info-card --reporter=basic` → `passed`
- [ ] `npm run i18n:check` → `i18n ok`
- [ ] `node --check scripts/verify/overview-board/verify.mjs` → `0`

## 记录

- 2026-11-17：G1（@nita，prdHash 6b908a42f1bc）/ G2（红证：`overview-board-props.test.ts` 11 failed expected-red，`resolveBoardPropRows` 未实现）/ G5 已清；实现 commit `83b6e5c8d`（feat(session-overview): 卡面自定义属性 + 列表行 tags/属性 chips + 悬浮卡加载占位）。
- 2026-11-17：绿证补记（本机 macOS）：`npx vitest run frontend/app/session-overview/overview-board-props.test.ts` → 11/11 passed（红证同套由 11 failed 转绿）。
- **待办（引擎侧，Windows 机器）**：本机 queue.mjs 不可用（路径写死 `E:/primary/projects/loop`），此包的 pick/commit/verify 台账事件缺失；G6（方案）/ G7（人验收）未签。见 `loop/INBOX.md` 对应欠账行。
- **待办（人）**：G7 —— 真机看板卡 status 彩色胶囊 / 列表行 tags chips / 悬浮卡加载占位三面走查。真机台 `overview-board` 判据 `node --check` 已在列，环境恢复后补跑。
