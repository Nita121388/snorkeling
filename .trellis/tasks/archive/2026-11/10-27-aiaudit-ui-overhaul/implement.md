# Implement: AI Audit 界面整改

## 顺序与验证点

### Step 1 — 后端数据正确性（`pkg/aisessions/audit_store.go`）

1. `AuditStatsResult` 增加 `Hourly []AuditHourBucket`，新增类型 `AuditHourBucket{Hour,Count,Failed}`。
2. `AuditStats`：
   - 先执行 stale sweep（30min，进程内 60s 节流，`sync/atomic`）；
   - `AVG` 改为只统计 `state='done' AND duration_ms > 0`；
   - 追加 24h 小时桶查询 + Go 侧聚合（固定 24 桶）。
3. `listAuditLogs`：`LOWER(col) LIKE lower(pattern)`，并把 `session_key` 加入搜索列。

验证：`node scripts/run-task.mjs test:pkg:aisessions`（或 `go test ./pkg/aisessions/`）。

### Step 2 — 生成产物

`node scripts/run-task.mjs generate` → 检查 `git diff frontend/types/gotypes.d.ts` 只含 hourly 字段。

### Step 3 — 前端纯函数模块 `aiaudit-format.ts`

导出：`formatDuration / formatClock / dayKey / dayLabel / stateMeta / isStuck /
resultLabel / shortSessionKey / bucketHeights / hasMorePages`。
无 React 依赖，便于单测。

### Step 4 — model 扩展（`aiaudit-model.ts`）

- `statsRefreshAtom`（时间戳）/ `clearArmedAtom` / `commentAtom`（操作反馈文案）
- `load(opts?: { append?: boolean; silent?: boolean })`：append 时 offset=entries.length；
  轮询路径在 append 模式下跳过；`document.hidden` 跳过。
- `loadStats(force?: boolean)`：10s 节流。
- `clear(days)` 返回 removed 并写 `commentAtom`。
- `loadMore()`。

### Step 5 — 视图重写（`aiaudit-view.tsx`）

按 design.md §2 组件拆分重写；保留现有 portal 注释与 `AuditRawBlock`。

### Step 6 — 测试

- 新增 `frontend/app/view/aiaudit/aiaudit-format.test.ts`（纯函数）。
- 可选 `aiaudit-view.dom.test.tsx`：渲染 3 行（done/failed/stuck），断言
  `is-failed` / `is-stuck` class 与 `stuck` 文案存在。

验证：`npx vitest run frontend/app/view/aiaudit --environment jsdom`。

### Step 7 — 整体检查

- `node scripts/run-task.mjs lint`（或 `npx tsc --noEmit` + eslint 目标文件）
- `node scripts/run-task.mjs test:pkg:aisessions`
- CDP 实测（app 若可启动）：`.aiaudit-root` 宽度 == block 内容宽度。

## Review gates

- G1（Step 1 后）：后端 diff 是否只动 audit_store.go + 生成物；测试是否新增覆盖。
- G2（Step 5 后）：视觉是否只用 token；有无引入 `window.confirm`；a11y 是否到位。
- G3（收尾）：`git status` 确认无生成物误改、无临时文件。

## 回滚点

- 每个 Step 独立可回滚；Step 2 的生成物若出现大范围无关 diff，直接 `git checkout -- frontend/types/gotypes.d.ts frontend/app/store/services.ts` 并改为手写最小类型（作为兜底，需在 PR 说明）。
