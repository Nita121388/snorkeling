# 执行计划：扫描内存治理与渐进式加载

## 0. 前置检查

```powershell
# 工具链（Windows 必须走子 PowerShell 载入本地环境）
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go version"

# 基线：当前测试是否本来就绿
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/..."
```

- [ ] 记录基线结果（哪些用例本来就红，避免误判为回归）
- [ ] 确认工作区他人改动：`git status --porcelain`（当前有 `frontend/app/workspace/widgets.tsx`、`package-lock.json`）→ **不 stage**

## 阶段 A — 内存止血（P0，独立可提交）

### A1 扫描协调器（新文件 `pkg/aisessions/scancoordinator.go`）

- [ ] `ScanOptions` / `ScanProgress` / `scanFlight` 类型
- [ ] `Manager.scanKey()`
- [ ] `Manager.ScanAllSummaries(ctx, opts)`：singleflight + 预算 ctx + 进度回调 + 部分结果
- [ ] `ManagerOptions.OnScanProgress func(ScanProgress)` 字段，`NewManagerWithOptions` 透传
- [ ] 预算耗尽时不标记 `HasSummaryScan` 完成
- [ ] 测试：`scancoordinator_test.go`（singleflight / budget partial / 并发取消）

验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/ -run 'ScanAllSummaries' -v"
```

### A2 `resolveSession` 快速返回

- [ ] `manager.go:1061` 改造：SQLite 有行（`requireCurrent=false`）→ 直接返回 + 必要时 `refreshSummariesInBackground`
- [ ] SQLite 无行 → `ScanAllSummaries`（不得再直接调 `ScanSummaries`）
- [ ] 保留 `refresh=true` 时的原有分支语义
- [ ] 测试：`TestResolveSessionStaleCacheFastPath` / `TestResolveSessionNoRowScans`

验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/ -run 'ResolveSession' -v"
```

### A3 `populateMessageCounts` 预算

- [ ] 新增 `messageCountBudgetBytes`（默认 128MB，env `SNORKELING_AISESSIONS_MSG_BUDGET_BYTES`）
- [ ] 累计 `len(Text)+len(Thinking)`，超预算后跳过解析并保留既有 `MessageCount`
- [ ] 测试：`TestPopulateMessageCountsBudget`（预算内全解析 / 超预算截断）

验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/ -run 'PopulateMessageCounts' -v"
```

### A4 单文件闸门 + `scanTitle` 上限

- [ ] `provider_pi.go`：`summaryParseMaxFileBytes`（默认 32MB）→ 跳过 `scanTitle`，标题回退 project basename
- [ ] `scanTitle` 增加 `titleScanMaxBytes`（默认 1MB）读取上限
- [ ] codex provider 同等闸门（`parseSummaryFile` 已 head/tail，仅补大小检查）
- [ ] 测试：`TestScanTitleRespectsByteCap`

验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/ -run 'ScanTitle|SummaryGate' -v"
```

**Gate A**（提交点 1）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go vet ./pkg/aisessions/...; go test ./pkg/aisessions/..."
git diff --stat
```

## 阶段 B — 最新优先（P0）

### B1 mtime 倒序

- [ ] `util.go: sessionFilesFromPaths` 收集后 `sort.Slice` 按 `MTime` 倒序
- [ ] 说明：`List` 内按序处理，命中 limit/budget 即提前结束
- [ ] 测试：`TestSessionFilesNewestFirst`

### B2 扫描预算贯通

- [ ] `ScanSummaries` 保持签名，调用方传预算 ctx（`ScanAllSummaries` 内构造）
- [ ] 提前结束条件：`ctx` 到期 或 （无 query/tag/project 且已收满 limit）→ 由 `ScanAllSummaries` 的 `earlyLimit` 选项控制

验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/ -run 'NewestFirst|ScanBudget' -v"
```

**Gate B**（提交点 2）：`go vet` + `go test ./pkg/aisessions/...`

## 阶段 C — 渐进式列表（P1）

### C1 后端编排

- [ ] `ScanListResult`（`Scanning/Scanned/Total`）+ `ScanListWithDistribution` 兼容包装
- [ ] `HasSummaryScan == false` 或 `Refresh` → 立即返回 SQLite 现有行 + 后台扫描
- [ ] 服务层 `AISessionsListResponse` 增加 `Scanning/Scanned/Total`（无 omitempty）
- [ ] `wps.Event_AISessionsScanStatus` 常量 + `aisessions.ScanStatusEvent`
- [ ] service 注入 `OnScanProgress` → 节流发布 wps 事件（≥200ms 或 Scanned +50）
- [ ] `node scripts/run-task.mjs generate` 重新生成 `frontend/types/gotypes.d.ts`

### C2 前端

- [ ] `scanningAtom` / `scanProgressAtom`（jotai）
- [ ] `SkeletonSessionRow`（复用 `SessionRowFrame` 外壳；`aria-hidden`）
- [ ] `ScanProgressStrip`（`aria-live="polite"`，done 后 300ms 淡出）
- [ ] `use-scan-status.ts`：`waveEventSubscribeSingle("aisessions:scanstatus")`，progress 只更新 atom，done 防抖 400ms 调 `loadSessions(false)`
- [ ] `aisessions.tsx`：`loadSessions` 写 atom；列表尾部渲染骨架行 + 进度条；仅本地连接订阅
- [ ] 前端测试：`scan-progress.test.tsx`（骨架渲染 / done 触发一次刷新）

验证：

```powershell
node scripts/run-task.mjs generate
npx vitest run frontend/app/view/aisessions --reporter=dot
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go build ./pkg/... "
```

**Gate C**（提交点 3）：`go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/...` + `vitest aisessions` + 类型生成无意外 diff

## 阶段 D — 详情帧复用（P2，可单独搁置）

- [ ] `sessionMessageCache`（LRU 2 条 / 96MB，key = `Key + MTime + Size`）
- [ ] `loadMessages` 接入；`loadAllDelta` 复用
- [ ] 测试：`TestSessionMessageCacheHit/Miss/Evict`

**Gate D**（提交点 4）：`go test ./pkg/aisessions/...`

## 端到端验证（真实数据，只读）

```powershell
# 启动应用（CDP 便于观察）
node scripts/dev-isolated.mjs --profile cdp --vite-port 51742 --cdp-port 9222

# 观察 RSS 与日志
powershell -NoProfile -Command "Get-Process wavesrv* | Select-Object Id,@{n='RSS_MB';e={[math]::Round($_.WorkingSet64/1MB)}}"
```

- [ ] 冷启动打开 AI Sessions：≤300ms 出结果（含空列表 + 骨架），进度条递增，最终补齐
- [ ] 连续点 5 次刷新 + overview 同时轮询：`wavesrv` RSS < 1.5GB，日志无 `out of memory`
- [ ] 正在写入的活跃会话：`Summary` 不再触发同步全量扫（开 `WAVETERM_AI_SESSIONS_DEBUG=1` 看 `resolveSession` 路径）
- [ ] 列表首屏出现的会话确实是最近更新的（mtime 倒序生效）

## 回滚点

| 提交点 | 回滚方式 |
|---|---|
| Gate A | `git revert`（纯后端，无契约变化） |
| Gate B | `git revert`（排序 + 预算） |
| Gate C | `git revert`（新增响应字段 + 前端；旧前端忽略新字段也安全） |
| Gate D | `git revert`（纯内存缓存） |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 返回过期行导致标题短暂滞后 | 后台刷新 + 列表事件重取；滞后上限一次刷新周期 |
| 预算过小导致列表长期"部分" | 默认 8s 够扫完 1617 个 head/tail；env 可调 |
| 前端事件风暴 | 后端节流 + 前端 progress 只更新 atom（不重取） |
| 类型生成产生大 diff | 只新增 3 个字段，diff 应 <20 行；超预期则回退检查 |

## 会话纪律（踩过的坑）

1. **慢校验必须丢给 async 子代理，禁止在主会话同步跑。** 本仓库 `npx tsc --noEmit` 要跑数分钟，
   同步执行会阻塞主会话超过 60s 的硬性阈值（本次已被触发一次）。
   - 规则：预计 >60s 的命令 → `subagent` async 后台 + 本会话继续干别的，等原生完成通知。
   - 单包定向 `go test ./pkg/aisessions/ -run X` 是快速命令，可同步跑。
2. **Git Bash 的 `cmd /c "..."` 重定向不可靠**：有时 `>` 后的内容不是当成路径就是被吞。
   改用子 PowerShell `-File` 里 `cmd /c "go vet ... > file 2>&1"`（单层引号）。
