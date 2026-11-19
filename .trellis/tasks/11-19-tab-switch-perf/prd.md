# PRD：Tab 切换卡顿优化

## Goal

消除两类 Tab 切换卡顿：冷切换时页面加载占住主进程串行动作队列、温切换时 `reinitWave` 重跑一串 RPC 与重排。用户可感知的「点 Tab 有延迟 / 卡断」下降，且优化可一键回滚。

## Background（调查证据）

- 温切换每次都发 `wave-init`，renderer 走 `reinitWave()`（`frontend/wave.ts:175`），串行 `await` 5 次 `WOS.reloadWaveObject` + `reloadAllWorkspaceTabs`（再 N 次）。
- 冷切换在主进程 `processActionQueue` 里等 `initPromise` + `waveReadyPromise`（`emain/emain-window.ts:524-547`），期间后续点击排队。
- 已有缓解：乐观高亮 R9.1、双入队去重 R9.2（`tab-optimistic-active.ts` / `emain.ts:131`），只治视觉高亮，不解根因。
- R9 任务（`10-26-tab-startup-restore`）已明确把「队列感知最新意图插队（C）」与「`reinitWave` 减负（D）」列为拿数据后的后续片。本任务承接这两片。

## Requirements

- R1 先做低风险片：`reinitWave` 减负（子任务 `11-19-reinitwave-relief`）。
- R2 高风险的队列解耦后置（子任务 `11-19-tab-switch-queue-decouple`），必须在 R1 有可验证结果后才 start，默认开关关闭。
- R3 两片各自带独立回滚开关，关闭后行为与现状完全一致。
- R4 本机性能差，本轮验收只跑单测 / 静态检查 / 日志判据，不跑真机 Electron 验证台。

## Acceptance Criteria

- [ ] R1 子任务单测全绿且 tsc 基线不上升。
- [ ] R1 开关关闭时，`reinitWave` 的 RPC 序列与数量与改造前逐项一致（回归锁）。
- [ ] R2 在 R1 完成前保持 `planning`，不 start。
- [ ] 两片开关均在代码中可达且默认状态符合各自 PRD。

## Out of Scope

- 不动后端 `SetActiveTab` 关键路径（改了会丢 updates，见风险调查）。
- 不动热备 WebView 池（与 wavesrv OOM 整改撞车）。
- 不做真机 Electron 验证（用户明确豁免）。
- 不改 Tab 栏视觉、Block 布局、AI 会话。

## Task Map

- Parent：本任务（汇总验收）。
- Child 1（next）：`11-19-reinitwave-relief` — reinitWave 增量减负，带开关。
- Child 2（deferred）：`11-19-tab-switch-queue-decouple` — 动作队列与 wave-ready 解耦，默认关。

## Notes

- 风险调查页：`docs/answers/tab-switch-risk-20261119-131626.html`；根因调查页：`docs/answers/tab-switch-perf-20261119-131307.html`。
- 不新增 loop 工作项（用户要求直接按 Trellis 走，未要求 loop 台账）。
