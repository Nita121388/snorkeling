# 技术设计：Antigravity 状态接管（声明式 status）

## 1. 数据流

```
conversation_summaries.db (status 列)
  → DeclarativeSQLiteProvider.List/ParseSummary（同一 SELECT 多取 status 列）
  → normalizeRunState(status, lastModifiedMs, nowMs)（纯函数 + TTL）
  → SessionSummary.RunState
  → SQLiteIndex ai_sessions.run_state（ensureAISessionColumns 迁移）
  → 前端 List 结果 → 行级合流纯函数 → RunningDot/chip
```

- 只读不变：仍是 `mode=ro` 单次 SELECT，不新增扫描入口（scan-contract R7）。
- 状态新鲜度不靠新定时器：运行中会话的 per-conv db 持续写入 → mtime 变 →
  `refreshChangedSummaries` 重解析 → 顺带取到最新 status。TTL 只防「进程死了 status 永远停在 RUNNING」。

## 2. 归一化（pkg/aisessions/provider_declarative_sqlite.go）

```go
const declarativeRunStateTTL = 5 * time.Minute

// normalizeRunState: strings.Contains(strings.ToUpper(v), "RUNNING") && fresh → "running"；否则 ""
func normalizeRunState(statusValue string, lastModifiedMs int64, nowMs int64) string
```

- `IDLE` / 空 / 未知 → `""`；未知值 `debugf` 记录（不 fail List）。
- 时钟注入：函数收 `nowMs`；生产调用点传 `time.Now().UnixMilli()`。
- TTL 判定只在 status 为 RUNNING 时才看 `lastModifiedMs`（last_modified_time 列即既有 `updated` 映射，复用已解析值，不重复解析）。

## 3. 配置与合并（wconfig + provider_declarative_config.go）

- `AgentSessionProviderColumnsType` 加 `Status string \`json:"status,omitempty"\``。
- 内置 antigravity 默认条目 columns 补 `"status": "status"`。
- 逐字段覆盖语义不变（用户只改 db 路径不丢 status 映射）。
- schema/settings.json 重新生成（cmd/generateschema）。

## 4. 索引（pkg/aisessions/sqlite_index.go）

- `ai_sessions` DDL 加 `run_state TEXT NOT NULL DEFAULT ''`；`ensureAISessionRunStateColumn` 走 `ensureAISessionColumns`（既有模式，parent_key/kind 同款）+ 加列成功后 `invalidateSummaryScanMarker` + 不需要回填（老行 run_state='' 语义正确：未观察到运行）。
- `sqliteSessionRow` 加 `RunState`；INSERT/UPDATE 列清单加 `run_state`；读回路径（List/ScanListResult 查询）带出。
- 列名注意：`ai_sessions` 已有 `updated_at`/`indexed_at`；`run_state` 不与任何现有列冲突（先 grep DDL 确认）。

## 5. 前端合流（frontend/app/view/aisessions/）

- `session-row.tsx` 现有左列 RunningDot 的数据源是 `useSessionsRunning()`（block 投影）。
- 新增纯函数（放 `session-run-badge-view.ts` 或新 `row-running.ts`，不 import React）：
  `mergeRowRunning(blockRunning: SessionRunningState | null, runState: string)` →
  `{ running: boolean, origin: "block" | "external" }`；块内优先（它有 blockId 可跳转）。
- 行内渲染：external running 复用现有 RunningDot 视觉（同 class），`title` 区分（"Running (external session)"，i18n key 走 aisessions.json 既有分组）。不加第二套颜色/动画。
- 右侧细粒度 run 徽章（AgentStatus phase）不接外部会话——db 无 phase，明确不做。

## 6. 验证台（scripts/verify/antigravity-runstate/verify.mjs）

- 判据机器可判定：临时 fixture summary db（status=RUNNING + 新鲜 last_modified_time）→
  settings 写 `agent:sessionproviders` 自定义条目指向 fixture → 列表出现该会话且行内运行指示存在；
  对照行（status=IDLE）无指示。
- 本机只跑 `--dry`；真机验证移机执行（同本任务系列既定纪律）。
- README area 表登记。

## 7. 权衡记录

- TTL 判定放后端归一化 vs 前端展示层：选后端。存进索引的值就是可展示值，前端不重复实现时效逻辑（跨层一份实现）。
- run_state 进 ai_sessions vs 独立状态表：选加列。status 是 summary 的派生展示字段，跟随 summary 生命周期（missing=1 一起消失），不值得独立表 + 独立失效链。
- 复用 `updated` 列的 last_modified_time vs 再取一次：复用。同一行数据，不重复解析。
