# Implement：筛选结果双向补带

## 后端

- [x] `pkg/aisessions/types.go`：`SessionSummary.Attached`；`ListOptions`/`SearchOptions` 加 `AttachMode`、`AttachMaxRows`；`ScanListResult.AttachTruncated`
- [x] `pkg/aisessions/context_attach.go`：`normalizeAttachMode` + `attachContext`
- [x] `pkg/aisessions/context_attach_test.go`：模式 / limit / 去重 / 硬排除 / 截断 / 孤儿 / missing
- [x] `pkg/aisessions/sqlite_index.go`：新增 `ListWithDistributionAndQuery`，`ListWithDistribution` 委托；`Search` 接入 attach
- [x] `pkg/aisessions/manager.go`：`scanListNow` 与 `cachedScanListWithDistribution` 接入 attach，删除重复 query 过滤
- [x] `pkg/service/aisessionsservice/aisessionsservice.go`：请求/响应字段透传

## 前端

- [x] `task generate` → `frontend/types/gotypes.d.ts`
- [x] `types.ts`：`AttachMode`、`DefaultAttachMode="both"`、localStorage 键
- [x] `aisessions.tsx`：`attachModeAtom` + `loadSessions` 传参 + `matchedKeys` 推导 + 自动展开替换 + 全选/复制语义
- [x] `utils.ts` / `session-group.tsx`：`matchedKeys` 透传到 `buildSessionTree`
- [x] `session-row.tsx`：`attached` 视觉（次要色 + 图标 + tooltip），元素 `data-attached`
- [x] `filter-panel.tsx`：三段式「包含上下文」开关
- [x] 结果计数 `N results (+M 上下文)`

## 补充：按 session id 筛选

- [x] `pkg/aisessions/index.go`：`summaryMatchesQuery` 纳入 `Key`，支持 `session:` / `id:` / `key:` 前缀
- [x] `pkg/aisessions/context_attach_test.go`：id / id 片段 / 前缀 / 整条 key 的正反例
- [x] 搜索框 placeholder 提到 session ID；行 tooltip 显示 `Session ID:`

## 补充：更新 / 创建时间排序

- [x] `types.ts`：`SessionSortField` 增加 `created`，`SortFields` 白名单同步
- [x] `utils.ts`：`sessionCreatedTime` + `compareByField` 支持 `created`
- [x] `sort-menu.tsx`：Updated / Created 两个时间字段与方向文案
- [x] `aisessions.tsx`：主排序键随 List 请求下发，主键变化触发重拉
- [x] `pkg/aisessions/types.go` + service：`SortField` / `SortDesc` 透传
- [x] `pkg/aisessions/providers.go`：`sortSummariesBy`（limit 之前排序，created 缺失回落 updated）
- [x] 测试：前端 comparator + sanitize；后端 limit=1 的 created 升/降序

## 验证

```bash
node scripts/run-task.mjs generate
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions"
npx vitest run frontend/app/view/aisessions
```

手工验收：见 `prd.md` 验收标准 1–7。

## 回滚点

- P1 后端（默认 off，前端未接线）：无用户可见变化。
- P2 前端（默认智能）：把 localStorage `aisessions.attachMode` 设为 `off` 即恢复。
