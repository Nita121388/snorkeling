# PRD：reinitWave 增量减负（带回滚开关）

## Goal

温 Tab 切换不再每次串行跑满 `reinitWave` 的 5 次 RPC + N 次 workspace tabs reload：只刷新本次切换真正需要的对象，把可并行的 reload 合并，保留所有正确性副作用，并提供一键回滚开关。

## Background（已确认事实）

- `frontend/wave.ts:175-200` 的 `reinitWave()` 每次温切换串行执行：
  1. `reloadWaveObject(client)`
  2. `reloadWaveObject(window)`
  3. `reloadWaveObject(workspace)` — 依赖 window 的 `workspaceid`
  4. `reloadWaveObject(tab)` — 依赖 savedInitOpts.tabId
  5. `reloadWaveObject(layout)` — 依赖 tab 的 `layoutstate`
  6. `reloadAllWorkspaceTabs(ws)` — 对 ws.tabids 每个再做一次 reload（同一 renderer 内 N 个 RPC）
- 依赖链：`workspace` 依赖 `window`，`layout` 依赖 `tab`；`client` 与 `window`/`tab` 无依赖。
- 副作用必须保留（风险调查页 C 面板）：`nohover` 反闪、`document.title`、`setWindowInitStatus("wave-ready")`、`reinitVersion++`（Tab 栏重排）、`scheduleUpdaterStatusSync()`、`globalRefocus()` 50ms、`reloadAllWorkspaceTabs`（标题/未读点新鲜度）。
- 现有回滚开关范式：`export const XXX_ENABLED = true`（如 `vcs-tree-status.ts:17`、`image-pager.tsx:42`）。

## Requirements

- R1 把 5 次串行 reload 按最小依赖分批：无依赖的 `client`/`window`/`tab` 一批并行；`workspace`（依赖 window）与 `layout`（依赖 tab）各自在其依赖就绪后立即发出。`reloadAllWorkspaceTabs` 保留，但只在 `ws.tabids` 有变化时重刷（用一次本地比较，不额外发 RPC）。
- R2 新增开关 `REINITWAVE_RELIEF_ENABLED`（默认 true）。false 时走与现状逐项一致的串行路径，含全部副作用。
- R3 把 reload 分批与副作用收口成一个纯函数（输入依赖、输出动作序列），单独单测；`wave.ts` 只做执行，不内嵌判定逻辑。
- R4 不 bump `reinitVersion` 之外的 Tab 栏刷新路径；`reinitVersion++` 必须保留。
- R5 保留 `nohover` 反闪、title、wave-ready 上报、updater 同步、50ms `globalRefocus` 全部副作用，开关两条路径一致。

## Acceptance Criteria

- [ ] A1 纯函数单测：给定依赖，输出 2 批（3 + 2），顺序符合依赖链；关闭开关时输出 5 次串行序列且与现状逐项一致（回归锁）。
- [ ] A2 纯函数单测：两条路径都包含全部 7 项副作用，顺序一致。
- [ ] A3 `reloadAllWorkspaceTabs` 在 `ws.tabids` 未变时不再发 N 个 RPC（单测断言调用次数为 0）；变化时仍逐个 reload。
- [ ] A4 `npx vitest run <新增测试文件>` 全绿（本机可跑，不需要真机）。
- [ ] A5 `node scripts/check-tsc-baseline.mjs` 退出码 0，错误数不超过基线（当前基线见 `docs/project/tsc-baseline.json`）。
- [ ] A6 `git diff --name-only` 仅涉及 `frontend/wave.ts` 与新增的纯函数/测试文件，无越界。

## Out of Scope

- 不动 `emain/` 主进程动作队列（子任务 2）。
- 不改 `initWave()` 首开路径、不改 `frontend/app/store/wos.ts`。
- 不改后端、不改热备池、不改 UI 样式。
- 不跑真机 Electron 验证台（用户明确豁免，本机性能差）。

## Technical Notes

- 目标文件：`frontend/wave.ts`（`reinitWave`/`reloadAllWorkspaceTabs`）；新增纯函数模块建议 `frontend/app/wave/reinit-wave-plan.ts` 与同名 `.test.ts`（`@/app/*` alias 已配置）。
- 纯函数只做「输入依赖 → 输出动作批次 + 副作用清单」，不 import WOS/React，便于本机单测。
- 风险页 `docs/answers/tab-switch-risk-20261119-131626.html` C 面板列出 7 条副作用，逐条对应 R5/A2。

## Open Questions

无。用户已确认：本机性能差，跳过真机验证。
