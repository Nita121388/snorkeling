# 执行计划：Overview 看板 v2（A + B）

> 串行执行，A 完成后才动 B（同一组文件，避免并行冲突）。

## 步骤

1. [ ] **A-1** 抽 `agent-status-chip.tsx`（搬 `AgentStatusChip` / `statusDurationText` / `shouldShowAgentStatusChip`），
       `session-overview.tsx` 改 import —— 列表渲染零变化。
2. [ ] **A-2** `overview-board-model.ts` 新增 `OverviewBoardCard` / `OverviewBoardAvatar` 与纯函数
       （`resolveBoardCardTitle` / `providerDisplayLabel` / `projectNameFromPath` / `formatBoardAge`）。
3. [ ] **A-3** `blockTitle()` 末尾补 `basename(meta["cmd:cwd"])` 兜底。
4. [ ] **A-4** `SessionOverviewPanel` 组装卡片数据（personas + sessionEmojis + summaries + details + agentStatuses），
       `OverviewBoard` 改为吃 cards。
5. [ ] **A-5** `BoardCard` 新信息架构：avatar + 标题 + age / 状态 chip + provider + 项目 / 预览 / note。
6. [ ] **B-1** `includeEmpty: true`；空列占位 `.session-overview-board-empty`。
7. [ ] **B-2** 列头状态点 `-column-dot` + 计数；卡片 dot 移除。
8. [ ] **B-3** CSS 改横向 snap 单行布局，删 container-query 堆叠分支。
9. [ ] **B-4** 验证台扩展断言（8 条新增）+ 跑真机。

## 验证命令

```bash
npx vitest run frontend/app/session-overview/            # 单测（含既有 213 行 board 测试）
npx tsc --noEmit -p tsconfig.json | grep -c "error TS"   # 基线 69，不得增加
node scripts/verify/preview-edit/run.mjs --keep-open --expect=fixed   # 起隔离实例
node scripts/verify/overview-board/verify.mjs --attach                 # 全绿
```

## 门与回滚点

- 每完成 A-5 / B-3 各跑一次 `vitest` + `tsc` 基线对比；tsc 新增 error 即为失败。
- 真机验证失败且短时间无法定位 → `OVERVIEW_BOARD_ENABLED = false` 回滚看板入口，列表不受影响。
- A、B 各自独立 commit（A 不依赖 B 的样式，B 不依赖 A 的数据）。

## 收尾

- 台账 `docs/project/verify-ledger.md` 由脚本自动追加；本任务再做一次人工确认行数。
- 若踩到新坑（嵌套滚动、snap 与虚拟滚动冲突），回写
  `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md` 或 `docs/project/ui-verify-playbook.md`。

---

## 完成记录（2026-11-05）

A、B 串行完成，同一组文件一起提交（拆两个 commit 需要在同一文件里拆 hunk，收益不抵风险）：

- 提交内容见 `11-05-overview-board-card-arch/implement.md` 与 `11-05-overview-board-columns/implement.md`
- 真机验证：`node scripts/verify/overview-board/verify.mjs` → **28/28**（连跑两次稳定）
- 单测：`npx vitest run frontend/app/session-overview/` 99 passed；`tsc` 基线 69 未增

### 与计划的偏差

1. 列数是 **5**（blocked/working/done/idle/stale），PRD 草稿里写的 6 是笔误，已全量修正。
2. A、B 合并为一个 commit（同文件交叉改动），不是两个独立 commit。
3. `overview-board` 验证台此前**从不写台账**（自己拼 report.json）；本轮接入 `appendLedgerRow`。
4. 验证台新增「播种 agent 块」步骤：全新 profile 只有 term 块，emoji/标题/状态 chip 三条最关键断言
   此前只能 skipped，现在用 `createBlock(agent:provider)` + `BlockService.ReportAgentStatus` 真机覆盖。

### 未覆盖 / 待后续

- 视图切换（board by tab / by provider）与 Gantt：见后续子任务（C、D），Gantt 需先出原型。
- 卡片 `note` 行的真实数据（需要真实会话 note）在播种场景下没有覆盖，靠真实使用观察。
