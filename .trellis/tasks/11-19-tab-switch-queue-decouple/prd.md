# PRD：动作队列与 wave-ready 解耦（后置，带开关）

## Goal

把等待前端 wave-ready 握手的动作移出主进程串行动作队列，消除冷切换时「页面加载占住队列 → 后续点击卡断」；必须在 reinitWave 减负验证后单独开片，默认开关关闭。

## Status：DEFERRED（不 start）

- 前置：子任务 `11-19-reinitwave-relief` 完成且有单测结果。
- 本片在 `11-19-reinitwave-relief` 归档前保持 `planning`，由父任务汇总时决定是否解锁。

## Background（调查证据）

- `emain/emain-window.ts:510-547`：`setActiveTab` → `_queueActionInternal` → `processActionQueue`，串行处理。冷 Tab（cache miss）在 `setTabViewIntoWindow → initializeTab` 里 `await initPromise` 与 `await waveReadyPromise`，期间整个队列阻塞。
- `[tabswitch]` 日志实测：冷切换 `total=1672ms backend=583ms webview=13ms setview=1076ms`，耗时集中在 setview（等 renderer 就绪）；温切换 27-42ms。
- 风险调查 `docs/answers/tab-switch-risk-20261119-131626.html` B 面板列出 6 项竞态：activeTabView 被覆盖、finalizePositioning 移屏、focus 守卫失效、wave-init 早于 handler、R9.2 去重依赖队列、半初始化 view 被 close。

## Requirements

- R1 默认关闭的开关 `TABSWITCH_QUEUE_DECOUPLE_ENABLED = false`；开启前行为与现状完全一致。
- R2 把「等 wave-ready」从动作队列关键路径移出，但保留串行保护 window contents view 的互斥（不得让两个 switch 同时写 activeTabView）。
- R3 保留 R9.2 `isTabSwitchInFlight` 去重语义（改判定数据源时须同步调整）。
- R4 解决风险调查 B 面板的 6 项竞态，逐项给出机器可判定的回归锁。

## Acceptance Criteria

- [ ] 开关默认 false，且 false 路径逐项等价现状。
- [ ] 6 项竞态各有对应单测或静态断言。
- [ ] 冷切换 `[tabswitch] total` 在真机有前后对比数据（本轮用户豁免真机，数据留待解锁时补）。
- [ ] `node scripts/check-tsc-baseline.mjs` 不上升。

## Out of Scope（本片也不做）

- 后端 `SetActiveTab` 异步化（丢 updates 风险）。
- 热备 WebView 池扩充（撞 wavesrv OOM 整改）。
- UI 视觉改动。

## Notes

- 开关默认关闭的理由：竞态面多，且本轮无真机验证，无法给「开启后安全」的机器证据。
