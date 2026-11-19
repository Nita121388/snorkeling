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

## 机器证据（执行器级，2026-11-19 收尾补）

上一版只证明了「纯函数计划输出」，journal 记录缺「执行器真的少发 RPC」的证据。本节补齐。

### 最小可测化重构（行为不变）

- 新增 `frontend/app/wave/reinit-wave-executor.ts`：把原内联在 `wave.ts` 的执行器抽成可注入
  `ReloadExecutor { makeORef, reloadWaveObject }` 的纯执行器。
  - `executeReinitReloads(batches, deps, exec)`：逻辑逐行照搬原实现（批间串行 / 批内 `Promise.all` /
    workspace 取 `window.workspaceid` / layout 取 `tab.layoutstate` / oref 为 null 时跳过）。
  - `executeWorkspaceTabReloads(tabIds, exec)`：取代内联 `reloadAllWorkspaceTabs`，同样 fire-and-forget。
- `frontend/wave.ts` 只做调用：`executeReinitReloads(plan.batches, deps, WOS)`、
  `executeWorkspaceTabReloads(tabIdsToReload, WOS)`；删除两个内联函数，`git diff` 为纯搬移。
- 新增 `frontend/app/wave/reinit-wave-executor.test.ts`：9 例执行器级测试（mock 计数），
  与既有 13 例计划层测试合计 22 例。

### 关键数字（mock `reloadWaveObject` 的调用次数 / 顺序，均为字面断言）

| 场景 | reloadWaveObject 次数 | workspace tab reload 追加次数 | 序列 |
|---|---|---|---|
| on + tabids 未变 | **5** | **0** | client→window→tab ‖ workspace→layout |
| on + tabids 变化 | 5 | **3**（tab:t1,t2,t3） | 同上 + 逐个新 id |
| on + 首帧 prev=undefined | 5 | 3（现状语义） | 同上 |
| off（回归锁） | **5** | tabids 未变也 **3** | client→window→workspace→tab→layout，逐项串行 |
| off + tabids 变化 | 5 | 3 | 同上 |

- **并行证据（deferred mock）**：batch0 的 3 个 reload 在任何一个 resolve 前就全部发出
  （`started = [client:c1, window:w1, tab:t1]`、`pending.length === 3`）；batch0 全部完成后才发 batch1 的
  两个（`workspace:ws1, layout:ls1`）。off 路径同一时刻只有 1 个在飞（逐项串行）。
- **依赖正确性**：workspace 的 oref 来自 reload 出的 `window.workspaceid`（`workspace:ws1`），
  layout 来自 `tab.layoutstate`（`layout:ls1`）；依赖字段缺失时跳过该次 reload（3 次而非 5 次）。
- **A3 执行器级判据**：`planWorkspaceTabReload(prev=同值, current)` → `null` →
  `executeWorkspaceTabReloads(null)` 追加 **0** 次 RPC（总次数仍为 5）。

### 命令与结果

| 命令 | 结果 |
|---|---|
| `npx vitest run frontend/app/wave/` | `Test Files 2 passed`、**`Tests 22 passed`**（13 计划层 + 9 执行器层） |
| `node scripts/check-tsc-baseline.mjs` | exit 0；grep `wave.ts` / `reinit-wave` 无错误条目（未新增类型债） |
| `npx eslint frontend/wave.ts frontend/app/wave/` | 0 error（仅 `wave.ts:62` 既有 prefer-const warning，非本包引入） |

### 仍不覆盖（诚实声明）

- 真机计时/帧率：本机豁免（PRD Out of Scope），以上只证明 RPC 次数与并发批次的字面下降。
- `reinitWave` 的 7 项副作用仍是同一份 `SIDE_EFFECT_ORDER` 清单，本包未改动其执行代码路径。
