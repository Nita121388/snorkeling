---
id: N-1126-perf-w2-3-render-virtualize
title: "Wave 2-3: DirectoryTable 虚拟化 + 终端热更新缩窄 + WPS 订阅合批 + 隐藏定时器休眠"
type: bug
priority: P0
severity: S2
status: open
origin: self
source: design/plans/snorkeling-perf-wave2-3-handoff-20261126.md
task: 11-26-perf-w2-3-render-virtualize
order: 100
touch: [frontend/app/view/preview/preview-directory.tsx, frontend/app/view/preview/directory-virtualize.test.ts, frontend/app/view/term/term.tsx, frontend/app/view/term/term-init-deps.test.ts, frontend/app/store/wps.ts, frontend/app/store/wps-batch.test.ts, frontend/app/agent-status/agent-status-done-tick.ts, frontend/app/agent-status/timer-hidden.test.ts, frontend/app/view/processviewer/processviewer.tsx, frontend/app/view/aiaudit/aiaudit-view.tsx, frontend/app/view/aisessions/aisessions.tsx, frontend/app/view/aisessions/session-group.tsx, docs/project/verify-ledger.md, loop/**, .trellis/tasks/11-26-perf-w2-3-render-virtualize/**]
rollback: null
budget: {minutes: 180}
releaseCandidate: false
createdAt: "2026-11-26T14:05:00Z"
---

# Wave 2-3: 渲染面治理

## 背景

Preview 目录表全量渲染 + onScroll 防抖整表重渲；term.tsx TermWrap effect 依赖整个 termSettings
（改热更新设置销毁重建所有终端）；wps.ts 订阅无去重无合批（O(N²) scope 传输）；隐藏页面定时器不休眠。

## 来源

- self：design/plans/snorkeling-perf-wave2-3-handoff-20261126.md §Wave 2 包 3（W2-3）

## 验收判据

- [x] `npx vitest run frontend/app/view/preview/directory-virtualize.test.ts frontend/app/store/wps-batch.test.ts frontend/app/agent-status/timer-hidden.test.ts frontend/app/view/term/term-init-deps.test.ts && echo W2_3_CONTRACT_OK` → `W2_3_CONTRACT_OK`（4f/10t 全绿，红证 8 red → 绿；主 agent 复跑一致）
- [x] `npx vitest run frontend/app/view/preview frontend/app/view/term frontend/app/store --no-file-parallelism && echo W2_3_REGRESSION_A_OK` → `W2_3_REGRESSION_A_OK`（74f/705t 全绿，主 agent 复跑一致）
- [x] `npx vitest run frontend/app/agent-status frontend/app/view/processviewer frontend/app/view/aiaudit frontend/app/view/aisessions --no-file-parallelism && echo W2_3_REGRESSION_B_OK` → `W2_3_REGRESSION_B_OK`（69f/1037t 全绿，主 agent 复跑一致）
- [x] `node scripts/check-tsc-baseline.mjs && echo W2_3_TSC_OK` → `W2_3_TSC_OK`（57 = 基线 57，0 新增；eslint 改动文件 0 error）

## 记录

- 红证：`.trellis/tasks/11-26-perf-w2-3-render-virtualize/red-proof.txt`（HEAD 8 red / 2 green 保留约束）
- R1 preview-directory：useVirtualizer 虚拟化 TableBody（滚动容器取 overlayscrollbars viewport，scrollMargin 对表头偏移）；scrollHeight state/防抖删除，data-scroll-height 直写 dataset；TableRow React.memo + dragItem useMemo + 回调 ref 身份稳定；键盘导航到未挂载行走 scrollToIndex。
- R2 term.tsx：init-only 依赖 [blockId, termFontSize, termScrollbackSetting, termBlockScrollback, termDisableWebgl]；macOptionIsMeta/cursorStyle/cursorBlink/ignoreBracketedPasteMode 走新 apply effect 就地应用；theme/renderer 由 TermThemeUpdater 原有热更新。
- R3 wps.ts：后端 Subscribe 是每 (route,event) 全量替换语义 → 模块级期望态 Set + pendingEventTypes 合批 + queueMicrotask flush，每 eventType 一条 EventSubCommand；reconnect 走立即重发；补 WpsRpcClient 空守卫。
- R4：done-tick（tick 跳过 + visibilitychange 补拍）/ processviewer / aiaudit 轮询 hidden 门控；aisessions refreshTimeNow 下沉为叶子 LastRefreshLabel（30s tick + hidden 门控），顶层 state/effect 删除，session-group flatTree useMemo。
- 遗留：斑马纹奇偶对齐用 0 尺寸占位 div（scss 不在白名单，改 idx 奇偶 class 更干净）；G7 真机滚动/终端不重建/隐藏页 CPU/拖拽多选右键交互由 nita 验收。
