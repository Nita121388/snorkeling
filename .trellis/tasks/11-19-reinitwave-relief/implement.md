# Implement：reinitWave 增量减负

## 白名单（写出界即停）

- `frontend/wave.ts`
- `frontend/app/wave/reinit-wave-plan.ts`（新增）
- `frontend/app/wave/reinit-wave-plan.test.ts`（新增）

## 执行顺序

1. **纯函数与测试先行（TDD）**
   - 新建 `frontend/app/wave/reinit-wave-plan.ts`，导出 `REINITWAVE_RELIEF_ENABLED`、`planReinitWave`、`Deps` / `Plan` / `ReloadKind` / `SideEffect` 类型（契约见 design.md §4）。
   - 新建 `.test.ts`，先写失败用例：
     - enabled=true：`batches` = `[["client","window","tab"],["workspace","layout"]]`。
     - enabled=false：`batches` = 5 个单元素、顺序 `client,window,workspace,tab,layout`（回归锁）。
     - 两条路径 `sideEffects` 数组完全相等且含 design.md §4 的 7 项。
     - `prevWsTabIds` 与 `wsTabIds` 浅等 → `tabIdsToReload === null`；不等 → 等于 `wsTabIds`。
     - 首帧 `prevWsTabIds === undefined` → 返回 `wsTabIds`（保持现状语义）。
   - 跑 `npx vitest run frontend/app/wave/reinit-wave-plan.test.ts` 到全绿。

2. **接线 `wave.ts`**
   - 删除 `reinitWave()` 内联的 5 次串行 `reloadWaveObject` 与内联 `reloadAllWorkspaceTabs(ws)` 调用。
   - 改为：构造 `deps`（含 `prevWsTabIds` 模块缓存）→ `planReinitWave(deps)` → 按 `batches` 逐批 `Promise.all`，用局部 `results` 表传依赖 → 按 `plan.tabIdsToReload` 决定是否 reload tabs。
   - 副作用顺序保持不变：nohover 在最前；收尾仍是 title → wave-ready → reinitVersion++ → updater → 50ms refocus。
   - `wave.ts` 顶部加 `import { planReinitWave } from "@/app/wave/reinit-wave-plan"`。
   - 模块级 `let lastWsTabIds: readonly string[] | undefined;` 缓存。

3. **回滚开关验证**
   - 临时把 `REINITWAVE_RELIEF_ENABLED = false`，跑单测的 off 分支用例确认回归锁。
   - 改回 `true`。

4. **静态检查**
   - `node scripts/check-tsc-baseline.mjs` → 退出码 0。
   - `git diff --name-only` → 仅白名单三文件。

## 判据（命令 → 期望输出）

| # | 命令 | 期望 |
|---|---|---|
| A4 | `npx vitest run frontend/app/wave/reinit-wave-plan.test.ts` | `Test Files 1 passed`、`Tests N passed`（N ≥ 6） |
| A5 | `node scripts/check-tsc-baseline.mjs` | exit 0，错误数 ≤ 基线 |
| A6 | `git diff --name-only` | 仅 3 个白名单文件 |

## 风险点 / 回滚点

- **最大风险**：`workspace` 依赖 `window.workspaceid`、`layout` 依赖 `tab.layoutstate`。执行器必须用 `results` 表显式取值，不得假设 batch0 的数组下标对应固定 kind（用 kind → result 的 map）。
- **次要风险**：`reloadAllWorkspaceTabs` 跳过后标题陈旧。缓解：只在 tabids 完全未变时跳过；变化一律全量 reload。若真机反馈陈旧，改开关为 false 即回滚（本轮不跑真机）。
- **回滚**：把 `REINITWAVE_RELIEF_ENABLED` 改 false，行为逐项回到现状；或 `git revert` 本任务 commit。

## 不做

- 不跑真机 / CDP / 验证台（用户豁免）。
- 不碰 `emain/`、后端、`wos.ts`、UI 样式。
- 不 start 子任务 2（队列解耦）。
