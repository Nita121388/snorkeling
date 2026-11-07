# 实施计划：Overview 看板卡片跨列移动动画

## 执行顺序（每步结束都可停下）

### Step 1 · 判据先行（红）

- 写 `frontend/app/session-overview/overview-board-motion.test.ts`，覆盖 10 条：
  1. `prev == null` → `[]`
  2. `containerWidth` 变化 → `[]`
  3. 状态列变化 → `kind: "move"` 且 `dx/dy` 等于 rect 差
  4. 状态不变仅位置变 → `kind: "reflow"`
  5. 新增 blockId → `kind: "enter"`，`dx = dy = 0`
  6. 消失 blockId → 不出现在结果里
  7. 亚像素位移（0.4 / 0.4）→ 跳过
  8. 单轴位移 > 1.5 × 视口 → 跳过
  9. `move` 超过 `maxMoves` → 超额条目降级为 `reflow`（不丢条数）
  10. 输出顺序：`move` 全部排在 `reflow` / `enter` 之前
- 写 `overview-board-motion.ts` 的**空壳**（`diffBoardLayout` 返回 `[]`，只定类型）。
- 命令 → 期望：`npx vitest run frontend/app/session-overview/overview-board-motion.test.ts` → **9 failed | 1 passed**（红证明，落 `queue gate --gate g2`）。

### Step 2 · 纯函数转绿

- 实现 `diffBoardLayout` + `BoardMotionDefaults` + `OVERVIEW_BOARD_MOTION_ENABLED`。
- 命令 → 期望：同一条命令 → **10 passed**。

### Step 3 · 组件接线

- `overview-board.tsx`：
  - `containerRef` + `layoutSignature`（`useMemo`，`blockId:status|...` 拼接）
  - `data-board-block-id` / `data-board-status` 挂到卡片最外层
  - `useLayoutEffect`（依赖 `layoutSignature`）：两段式采样 → `diffBoardLayout` → 批量 WAAPI
  - `armedRef` 首帧只记账；`matchMedia("(prefers-reduced-motion: reduce)")` 直接 return
  - `is-flying` 类 + `animation.finished.finally()` 清理
  - `landingTick` state 驱动落点 dot 光晕与计数徽章重播（首帧不触发）
- 命令 → 期望：`npx vitest run frontend/app/session-overview/` → 原有 60 条 + 新增 10 条全绿。

### Step 4 · 样式

- `session-overview.scss`：
  - `.session-overview-board-card.is-flying { position: relative; z-index: 2; }`
  - `@keyframes`：`overview-board-count-pop`、`overview-board-dot-land`
  - `@media (prefers-reduced-motion: reduce)` → `animation: none`
- 命令 → 期望：`npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `69`（不高于基线）。

### Step 5 · 真机验证（真跑一次，不喊人）

- 扩展 `scripts/verify/overview-board/verify.mjs`：加 `--expect=motion` 分支，3 条断言
  - `motion-midflight-interpolating`：改状态后立即采样，`rect.left` 严格落于旧列 x 与新列 x 之间
  - `motion-settled`：400ms 后 `rect.left` 与新列 x 误差 < 1px
  - `motion-first-paint-silent`：`list → board` 切换后 60ms 内无卡片 `is-flying`
- 命令 → 期望：`node scripts/verify/overview-board/verify.mjs --expect=motion` → 退出码 `0`，报告 `N/N`
- 台账：`docs/project/verify-ledger.md` 追加一行结论。

### Step 6 · 收尾

- 更新 `HANDOFF.md` 的「最近做完」一行。
- 提交：`feat(overview): 看板卡片跨列移动动效（FLIP + WAAPI）`，仅含 5 个文件
  （`overview-board-motion.ts` / `.test.ts` / `overview-board.tsx` / `session-overview.scss` / `scripts/verify/overview-board/verify.mjs`）+ 台账文件。

## 验证命令汇总

```bash
npx vitest run frontend/app/session-overview/                              # 期望：70 passed
npx vitest run frontend/app/session-overview/overview-board-motion.test.ts # 期望：10 passed
npx tsc --noEmit -p tsconfig.json | grep -c "error TS"                     # 期望：69（基线）
node scripts/verify/overview-board/verify.mjs --expect=motion              # 期望：exit 0
```

## 回滚点

| 点 | 动作 |
|---|---|
| Step 2 后（纯函数已绿，未接线） | 直接 revert 两个新文件，看板无变化 |
| Step 3/4 后（已接线） | `OVERVIEW_BOARD_MOTION_ENABLED = false` 一行降级，行为回到瞬移 |
| Step 5 后（已提交） | `git revert <commit>`；无数据迁移、无接口变更 |

## 不在本计划内

- card-actions 包的动作区（×/🗑）与卡片结构改造 —— 由 `11-06-overview-board-card-actions` 负责，本包只在 landing 后做一次结构对齐（design §7）。
