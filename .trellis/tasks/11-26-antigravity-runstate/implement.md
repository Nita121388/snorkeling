# 执行计划：Antigravity 状态接管

## touch 白名单（越界即停）

```
pkg/wconfig/settingsconfig.go                      (Columns 加 Status)
pkg/aisessions/provider_declarative_config.go      (内置 antigravity columns 补 status)
pkg/aisessions/provider_declarative_config_test.go
pkg/aisessions/provider_declarative_sqlite.go      (SELECT 加 status 列 + normalizeRunState)
pkg/aisessions/provider_declarative_sqlite_test.go
pkg/aisessions/types.go                           (SessionSummary.RunState)
pkg/aisessions/sqlite_index.go                     (DDL + ensureAISessionRunStateColumn + 读写带 run_state)
pkg/aisessions/sqlite_index_test.go
pkg/aisessions/sqlite_read.go                      (若 List 读回路径在此，带出 run_state)
frontend/app/view/aisessions/session-row.tsx       (外部 running 合流渲染)
frontend/app/view/aisessions/session-run-badge-view.ts  (或新 row-running 纯函数 + 测试)
frontend/app/view/aisessions/*.test.ts(x)
frontend/i18n/locales/en/aisessions.json
frontend/i18n/locales/zh/aisessions.json
scripts/verify/antigravity-runstate/verify.mjs     (新)
scripts/verify/README.md
```

生成文件（必须重新生成时才动）：`schema/settings.json`（cmd/generateschema）。
`.trellis/**`、`docs/project/verify-ledger.md`、`verify-runs/**` 记录类不设限。

## 步骤

1. **wconfig + 内置条目**
   - Columns 加 `Status`；builtin antigravity columns 补 `status`；schema 重新生成。
   - 判据：`go test ./pkg/wconfig` 绿；覆盖「用户只改 db 不丢 status 映射」既有合并用例仍绿。

2. **归一化纯函数 + provider 接线**
   - `normalizeRunState(value, lastModifiedMs, nowMs)`：RUNNING+新鲜 → "running"；其余 → ""（未知值 debugf）。
   - SELECT 声明列加 status；List/ParseSummary 填 `SessionSummary.RunState`；时钟注入点收敛在一处。
   - 判据：新增单测 ≥4（RUNNING 新鲜 / RUNNING 陈旧超 TTL / IDLE·空 / 未知值），fixture db 走真实查询。

3. **索引列 + 读写**
   - DDL 加 `run_state`；`ensureAISessionColumns` 迁移 + `invalidateSummaryScanMarker`；sqliteSessionRow / INSERT / UPDATE / 读回查询全部带 run_state。
   - 判据：老 schema 库打开自动加列（迁移用例）；扫描后 `run_state` 可查且值正确（round-trip 用例）。

4. **前端合流**
   - 纯函数 `mergeRowRunning(blockRunning, runState)`（块内优先）+ 单测；session-row 渲染外部 running（复用 RunningDot class，title 用 i18n 新 key）。
   - 判据：`npx vitest run frontend/app/view/aisessions` 全绿；tsc 新增 0。

5. **验证台**
   - `scripts/verify/antigravity-runstate/verify.mjs`（fixture RUNNING 会话行有指示 / IDLE 行无指示）；README 登记；本机只跑 `--dry`。
   - 真机：移机执行，台账入库。

6. **收口**
   - 提交前核对白名单（本任务文件独立 commit，不与工作树其他任务混入）。
   - spec 回写：`aisessions-declarative-provider-contract.md` 增「运行态」小节（归一化/TTL/块内优先合流/不接 phase 徽章）。

## 风险与回滚

| 风险 | 观测 | 回滚 |
| TTL 误伤长任务（>5min 无 last_modified_time 更新） | 真机长会话 | 调大 TTL 或按 not_fully_idle 补判 |
| run_state 列名撞既有列 | 步骤 3 grep DDL | 改名 run_status_col，迁移前无历史包袱 |
| 前端合流引入行高抖动（新指示撑高行） | vitest/真机 | 复用 RunningDot 原位渲染，不加新元素行 |

## 进度（2026-11-26 日间，提交快照）

- [x] 步骤 1 wconfig：`AgentSessionProviderColumnsType.Status` + 内置 antigravity `status` 映射 + schema 重新生成
- [x] 步骤 2 归一化：`normalizeRunState(status, lastModifiedMs, nowMs)` + TTL 5min 常量（RUNNING 新鲜→"running"，其余空）
- [x] 步骤 3 索引：`ai_sessions.run_state` 迁移 + 读写全链路（save/read round-trip 用例）
- [x] 步骤 4 前端合流：`mergeRowRunning()` 纯函数 + RunningDot `externalRunning` 分支（复用同点同位置、不可点击、`data-external-running`）+ i18n en/zh
- [ ] 步骤 5 验证台 `scripts/verify/antigravity-runstate/verify.mjs` ——**未做**，下次续
- [ ] 真机验证 —— 移机待跑（本机性能不足）

验证现状（本机已跑）：`npx vitest run session-run-badge-view.test.ts session-row.test.tsx` → 4 文件 / 82 用例全过（含 4 条 mergeRowRunning 新用例）。Go 侧 `go test ./pkg/wconfig` 通过；`pkg/aisessions` 有 2 条既有失败（`TestSQLiteIndexEmojiTablesCreatedIdempotently` / `TestSQLiteMigratePropTypeStatus`，git stash 基线同样失败，与本任务无关）。tsc 全量未跑完（本机性能不足，用户指示跳过）。
