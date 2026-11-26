# Wave 2-3: DirectoryTable 虚拟化 + 终端热更新缩窄 + WPS 订阅合批 + 隐藏定时器休眠

> 来源：`design/plans/snorkeling-perf-wave2-3-handoff-20261126.md` §Wave 2 包 3（W2-3）。
> 用户已授权（2026-11-26：「除了真机验证部分由我来执行，其他的请你将它们做完」）。

## Goal

治理四个"与用户操作频率无关但持续烧 CPU/重渲"的渲染面：Preview 目录表全量渲染 + onScroll 防抖整表重渲、终端设置热更新销毁重建所有终端、WPS 订阅无去重/无合批（O(N²) scope 传输）、隐藏页面定时器不休眠。

## 实证根因（handoff 文档锚点，实施前先复核行号）

- `frontend/app/view/preview/preview-directory.tsx:349-356, 674-687, 721-734`：注释写虚拟滚动但实际 `otherRows.map` 全量渲染；`onScroll` 2ms 防抖 `setScrollHeight` 触发整表重渲；每行 `useDrag` 传新 `dragItem` 对象每帧重绑拖拽。
- `frontend/app/view/term/term.tsx:347-348, 582`：创建 `TermWrap` 的 `useEffect` 依赖整个 `termSettings` 对象 → 改 `term:bellsound` 等可热更新设置会销毁重建所有终端。
- `frontend/app/store/wps.ts:46-65, 84, 107`：每次 `waveEventSubscribeSingle` / `waveEventUnsubscribe` 立即发 `EventSubCommand`，无 `scopes` 去重、无 microtask 合批（N 块同时挂载产生 O(N²) scope 传输）。
- 隐藏页面定时器未休眠：`frontend/app/app/agent-status/agent-status-done-tick.ts:30,49`、`frontend/app/view/processviewer/processviewer.tsx:218`、`frontend/app/view/aiaudit/aiaudit-view.tsx:100`、`frontend/app/view/aisessions/aisessions.tsx:2302`（`refreshTimeNow` 挂顶层 30s 触发整页 + 未虚拟化 `GroupedSessionList` 重渲）。

## Requirements

- R1 `preview-directory.tsx`：删除 `scrollHeight` state/防抖（如样式需要则直接写 `el.dataset.scrollHeight`）；修复 `TableRow` memo 与 `useDrag` 原始依赖；用 `@tanstack/react-virtual`（仓库已有依赖）虚拟化 `TableBody`。
- R2 `term.tsx:582`：创建 TermWrap 的 effect 依赖改为仅 init-only 字段（如 `blockId`、`termScrollback`、`disableWebgl`、`termFontSize`、`connFontFamily`），可热更新设置不再销毁终端。
- R3 `wps.ts`：`scopes` 用 `Set` 去重；`updateWaveEventSub` 按 `eventType` 走 `queueMicrotask` 合批（同 tick 多次订阅合并为一次 EventSubCommand）。
- R4 未门控定时器补 `document.hidden` 检查：`agent-status-done-tick.ts`、`processviewer.tsx`、`aiaudit-view.tsx`、`aisessions.tsx`（`refreshTimeNow` 下沉到叶子时间组件；`GroupedSessionList` 的 `flatTree` 加 `useMemo`）。

## Acceptance Criteria（机器判定）

- [ ] 源码契约红测转绿：`npx vitest run frontend/app/view/preview/directory-virtualize.test.ts frontend/app/store/wps-batch.test.ts frontend/app/app/agent-status/timer-hidden.test.ts frontend/app/view/term/term-init-deps.test.ts`（HEAD 上红）。
- [ ] `npx vitest run frontend/app/view/preview frontend/app/view/term frontend/app/store --no-file-parallelism` 全绿。
- [ ] `npx vitest run frontend/app/app/agent-status frontend/app/view/processviewer frontend/app/view/aiaudit frontend/app/view/aisessions --no-file-parallelism` 全绿。
- [ ] `node scripts/check-tsc-baseline.mjs`（57 基线，0 新增）。

### Out of scope

- G7 真机验收（滚动流畅度 / 终端不重建 / 隐藏页 CPU）→ 用户执行。
- W2-1 遗留的 Rollup manualChunks 入口 chunk 布局（另一 follow-up 包）。
- aisessions `GroupedSessionList` 的完整虚拟化（本包只动 flatTree useMemo + refreshTimeNow 下沉）。

## 风险

- 虚拟化改动可能破坏既有滚动锚定/多选/右键菜单交互 → 复用既有行组件，只改渲染层。
- term 依赖缩窄若漏字段会导致终端不按新设置重建（应热更新的项）→ effect 拆两段：init-only 重建 + 热更新 effect 就地应用。
- wps 合批范围要覆盖 unsubscribe，否则 scope 泄漏。
