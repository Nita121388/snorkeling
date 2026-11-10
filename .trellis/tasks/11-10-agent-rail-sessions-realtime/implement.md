# 执行计划

前置：工作区已有 17 个未提交改动（其他任务的），本任务只改下列白名单文件，不碰它们。

## 触碰白名单

- `frontend/app/view/session-outline-rail.tsx`（+ 单测）
- `frontend/app/view/term/term-agent-message-rail.tsx`（+ 单测）
- `frontend/app/view/aisessions/aisessions.tsx`
- `pkg/aisessions/manager.go`（+ 单测）
- `pkg/aisessions/types.go`
- `pkg/wps/wpstypes.go`
- `pkg/tsgen/tsgenevent.go`
- `pkg/service/aisessionsservice/aisessionsservice.go`（+ 单测）
- 生成物（`task generate` 产出）：`frontend/types/gotypes.d.ts` 等事件映射
- 新增 `scripts/verify/agent-session-rail/verify.mjs` + `scripts/verify/README.md` 登记
- `docs/project/verify-ledger.md`（结论行）

## 顺序

### S1 R1 水平滚动轴（最小改动先行）

- [x] `session-outline-rail.tsx` 滚动容器 className 加 `overflow-x-hidden`
- [x] `session-outline-rail.test.tsx` 加断言（className 含 overflow-x-hidden）
- 验证：`npx vitest run frontend/app/view/session-outline-rail.test.tsx`

### S2 R3 后端（先打事件通道，R2 前端可独立并行）

- [x] `pkg/aisessions/types.go`：`SessionsChangedEvent`
- [x] `pkg/wps/wpstypes.go`：`Event_AISessionsSessionsChanged` + 事件清单登记
- [x] `pkg/tsgen/tsgenevent.go`：类型映射
- [x] `pkg/aisessions/manager.go`：`DetectChangedSessionFiles`（stat-only）
- [x] `aisessionsservice.go`：`makeSessionsChangedPublisher`（2s 节流）+ `ensureLocalSessionsWatcher`
      （5s tick，env 覆盖，懒启动于本地 List/Search）
- [x] Go 单测：DetectChangedSessionFiles（新文件→1 / 未变→0）、发布节流
- [x] `node scripts/run-task.mjs generate`（tsgen 前端类型）
- 验证：`go test ./pkg/aisessions ./pkg/service/aisessionsservice`（经 use-local-env 子进程）

### S3 R3 前端

- [x] `aisessions.tsx`：抽 `backgroundRefresh` useCallback；订阅
      `aisessions:sessionschanged`（本地 + 去抖 500ms + 最小间隔 5s）
- 验证：`npx tsc --noEmit -p frontend`（或项目 typecheck 任务）+ vitest 相关套件

### S4 R2 刻度轨实时化

- [x] `term-agent-message-rail.tsx`：三层刷新调度（挂载/sessionId 变化、
      自适应轮询 3s 快 / 30s 慢 / 40 次快重试降级、agentstatus 事件去抖 800ms + 2s 最小间隔）
- [x] 单测（fake timers）：空结果重试、事件触发 forced 刷新、卸载清计时器、sessionId 变化重置
- 验证：`npx vitest run frontend/app/view/term/term-agent-message-rail.test.tsx`

### S5 真机验证台

- [x] 新建 `scripts/verify/agent-session-rail/verify.mjs`（复制 `_template`）：
      R1 断言（TUI rail + GUI 详情 rail 两处）、R2/R3 端到端（做不到自动化的写 skipped+原因）
- [x] `node scripts/verify/agent-session-rail/verify.mjs --attach` → 0
- [x] 台账 `docs/project/verify-ledger.md` 追加行；`scripts/verify/README.md` 登记 area

### S6 收尾

- [x] 全量：`node scripts/run-task.mjs` 相关 check（lint / vitest / go test 受影响包）
- [x] spec 回写（如需）：`.trellis/spec/snorkeling-docs/frontend/` 或 docs 沉淀本次教训
- [x] 单 commit 提交（含生成物）

## 回滚点

- S1/S2/S3/S4 各自独立可 revert；S2 事件对老前端无影响（新增事件类型）。
- 应急：`WAVETERM_AI_SESSIONS_WATCH_INTERVAL_MS=0` 关 watcher。

## 门与判据摘要

| 步 | 判据 | 命令 |
|---|---|---|
| S1 | className 含 overflow-x-hidden | `npx vitest run frontend/app/view/session-outline-rail.test.tsx` |
| S2 | go test 全绿 | `go test ./pkg/aisessions ./pkg/service/aisessionsservice` |
| S3 | typecheck 过 | tsc noEmit |
| S4 | 调度器单测全绿 | `npx vitest run frontend/app/view/term/term-agent-message-rail.test.tsx` |
| S5 | verify exit 0 / skipped 有理由 | `node scripts/verify/agent-session-rail/verify.mjs --attach` |
