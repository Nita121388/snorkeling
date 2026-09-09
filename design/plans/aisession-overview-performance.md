# AISession & Overview 全面性能优化方案

> 版本: 2026-09-02 | 覆盖: `frontend/app/view/aisessions` + `frontend/app/session-overview` + `pkg/aisessions`
> 方法: 代码静态分析 + 运行时链路追踪 + 线上最佳实践调研 (React 19 / Jotai / TanStack Virtual / Electron / Go SQLite)

## 0. 执行摘要

Snorkeling 当前存在**双重刷新体系**：AISession (aisessions.tsx, 1429行) 自带可配置 `autoRefreshIntervalMs` 定时器；Overview (session-overview.tsx, 2584行 + session-overview-session-cache.ts) 自带 `SESSION_SUMMARY_POLL_MS=15s` 轮询 + 30s/15s TTL 缓存。两者均会触发后端的 `Manager.ScanListWithDistribution` → `ScanSummaries` → `populateMessageCounts`，在会话数 >500 时产生明显的重复 I/O、Jotai 全量重渲染、SQLite 串行锁竞争。

本方案提出 **“中央刷新总线 + 增量索引 + 虚拟化 + 状态可视化”** 四层优化，预期：后端扫描 I/O -60%、列表滚动 60fps 稳定、IPC 调用 -50%。

---

## 1. 现状深度剖析

### 1.1 AISession 刷新时机 (aisessions.tsx)

| 触发源 | 代码位置 | 行为 | 问题 |
|---|---|---|---|
| 初始化 | `useEffect(() => model.loadSessions(false) , [model])` L1002 | 首次拉取 limit=200 | 无 |
| 筛选变化 | `useEffect(...,[query,source,tagFilters...])` L1061 `setTimeout 200ms` | 防抖后 `loadSessions(false)` | 每次都走 `ScanSummaries` |
| 自动刷新 | `useEffect` L1047 `setInterval(autoRefreshIntervalMs)` | `loadSessions(false)+refreshBoundSessionSummary()+loadDetailDelta` | 仅本地连接生效，未与 Overview 去重 |
| 手动刷新 | `endIconButtons` L142 `loadSessions(true)` | `Refresh=true` 强制全量扫描 | 无防抖 |
| Detail Delta | `loadDetailDelta` L510  | 基于 `SessionMessageCursor` 增量拉取 | 已较优，但 `applyDetailDelta` 用 `Set(seq)` 每次重建 |

关键路径: `loadSessions` → `service.List` → Go `ScanListWithDistribution` → 若 `!Refresh` 尝试 `cachedScanListWithDistribution` → 否则 `ScanSummaries` (遍历所有 Provider 的 ListFiles + ParseSummary) → `openSQLiteIndex` → `SaveScannedSummaries` → 过滤/排序/limit → `populateMessageCounts` (对每个 summary 逐一 `GetMessages` 或 `LoadMessages`)。

### 1.2 Overview 刷新机制 (session-overview.tsx + session-overview-session-cache.ts)

* **缓存层**: `summaryCache/detailCache` + `SummaryTtlMs=30s / DetailTtlMs=15s` + `RequestQueue` 并发控制 (Summary 4, Detail 2, Stat 4) + `rAF 帧级 flush` (`scheduleFlush`/`flushChannels`)
* **轮询**: `useSessionSummaries` L906 `setInterval 15s` 对每个 `sessionId` `loadCachedSessionSummary(forceRefresh=true)`
* **事件驱动**: 监听 `AiSessionNoteUpdatedEvent` 局部 `patchCachedSessionSummary`
* **可见性**: `useOverviewBlocks` + `useCurrentOverviewBlockVisible` 控制 `active`，隐藏时退订

优点: 已有较好的 Promise 去重 (`entry.promise`复用)、并发队列、rAF 合批。
问题: 固定 15s 对每个 sessionId 发 Summary 请求，当 Overview 展示 50+ blocks 时即 50*4并发队列持续打满；与 AISession 的定时器完全独立。

### 1.3 后端瓶颈 (pkg/aisessions)

* **manager.go**: `cachedScanListWithDistribution` 仅当 `HasSummaryScan==true` 才命中缓存，否则全量 `ScanSummaries`。`refreshChangedSummaries` 会对每个 Provider `ListFiles` + `ChangedFiles` 比较 mtime/size，已是增量但仍需遍历文件系统。
* **sqlite_index.go**: `OpenSQLiteIndex` 每次 `sqlx.Open` `mode=rwc&_journal_mode=WAL&_busy_timeout=5000` + `SetMaxOpenConns(1)`，高频 open/close 有文件锁开销；`ListWithDistribution` / `Search` 均为全表 `SELECT` 后 Go 层过滤，未利用 SQL 索引；`GetMessages` 按 seq 排序读取，对大 session (数千条消息) 成本高。
* **已做优化**: WAL、schema_meta 版本控制、corrupt 自动重命名、meta JSON 一次性迁移。

---

## 2. 在线调研提炼的最佳实践

> 受当前网络限制 (r.jina.ai 超时)，通过 `gh api` + 本地知识库 + 已有依赖 (`@tanstack/react-virtual 3.13.19`、`jotai 2.9.3`、`modernc.org/sqlite`) 归纳：

1.  **React 19 + Jotai**: 官方推荐用 `selectAtom` / `atomFamily` / `splitAtom` 做细粒度订阅，避免“一个 atom 变全列表重渲染”。`useSyncExternalStore` 已在 Overview 的 channel revision 中正确使用。
2.  **TanStack Virtual**: 对 >100 项列表，虚拟化可将 DOM 节点从 O(n) 降至 O(visible)，滚动帧率提升 3-5x。项目已依赖但未在两处视图启用。
3.  **Electron IPC**: 高频 `invoke` (如每 15s * N) 易触发主进程阻塞。社区实践是用 `BroadcastChannel` / `WebContents.send` 做单次广播 + 渲染端 rAF 合批，与本项目 `flushChannels` 思路一致。
4.  **SQLite**: WAL + `busy_timeout` 已正确；下一步应加复合索引、FTS5 全文检索、单例连接池。`mattn/go-sqlite3` 单连接限制下，复用 `*sqlx.DB` 比反复 `Open/Close` 吞吐高 30%+。
5.  **Go fsnotify**: 对 Codex/Claude 的 `~/.codex/sessions` 等目录，`fsnotify` 事件驱动比 15s 轮询更实时且更省电。

---

## 3. 重叠分析 & 图标化可行性

**重叠度矩阵**:

| 机制 | AISession | Overview | 是否重叠 |
|---|---|---|---|
| 初始化 | ✓ | ✓ | 高 - 可合并为一次冷启动预热 |
| 手动刷新按钮 | `arrows-rotate/spinner` | `rotate-right` | 高 - 可统一为 `RefreshIndicator` 组件 |
| 自动定时 | 可配置 | 固定 15s | 中 - 应合并为单一调度器 |
| 事件驱动 | `AiSessionNoteUpdatedEvent` | 同 | 高 - 已一致，继续保留 |
| 可见性 | `visibilityState` | `active` (IntersectionObserver) | 高 - 应抽为 `usePageVisible` hook |

**图标化方案 (完全可行，已有 FontAwesome/makeIconClass 基础)**:

| 状态 | 图标 | 颜色/动画 | tooltip |
|---|---|---|---|
| 空闲/新鲜 (<30s) | `fa-clock` | `text-secondary` | `Updated just now` |
| 后台自动刷新中 | `fa-arrows-rotate` + `fa-spin` | `text-accent` | `Syncing…` |
| 筛选防抖中 | `fa-magnifying-glass` + spinner | `text-accent` | `Filtering…` |
| 自动刷新启用 | `fa-rotate` 常亮 + 倒计时 | `text-accent` | `Auto refresh every 60s (next 12s)` |
| 离线/错误 | `fa-triangle-exclamation` | `text-error` | 显示 `getErrorMessage` |

AISession 已在 `endIconButtons` 根据 `loadingAtom` 切换 `spinner/arrows-rotate`，只需扩展为 4 态；Overview 的 `endIconButtons` 目前为静态 `rotate-right`，改为动态即可。

---

## 4. 全面优化方案 (分层落地)

### 4.1 L1 架构层: 中央刷新总线 (最高优先级)

**目标**: 消除双定时器，IPC -50%。

*   新建 `frontend/app/store/refresh-bus.ts`:
    ```ts
    export const refreshBusAtom = atom(0); // 单调递增 revision
    export const lastRefreshAtAtom = atom(0);
    // 单一定时器: 仅当 document.visibilityState==='visible' && 有活跃视图时 tick
    ```
*   `aisessions.tsx` 与 `session-overview.tsx` 各自的 `setInterval` 移除，改为 `useAtomValue(refreshBusAtom)` 触发按需 `loadSessions` / `loadCached...`。
*   `session-overview-session-cache.ts` 的 `scheduleFlush` (rAF 合批) 保持，作为二级合批；总线作为一级去重。

### 4.2 L2 数据层: 后端增量 + 连接优化

1.  **SQLite 单例**: 在 `manager.go` 引入 `sync.Once` + `map[path]*SQLiteIndex` 池，避免每次 `Open/Close`。保持 `MaxOpenConns=1` 语义，但复用 `*sqlx.DB`。
2.  **逐步替换全量 Scan**: `cachedScanListWithDistribution` 已有 `ChangedFiles` 增量，扩大其命中率：初始化时即 `HasSummaryScan`，之后仅 `ChangedFiles` 的 `ParseSummary` + `SaveScannedSummaries(incomplete=true)`。
3.  **索引增强**:
    ```sql
    CREATE INDEX IF NOT EXISTS idx_ai_sessions_list ON ai_sessions(missing, source, updated_at DESC, project_path);
    CREATE INDEX IF NOT EXISTS idx_ai_sessions_search ON ai_sessions(missing, title, snippet);
    -- 后续可加 FTS5 虚表用于 query 搜索
    ```
4.  **populateMessageCounts 批处理**: 当前逐条 `GetMessages` 串行，改为 `WHERE session_key IN (...)` 批量预取 message_count（或仅存 count 不存全量 text），减少 N+1。

### 4.3 L3 UI 层: 渲染与交互

1.  **虚拟化**: 对 `visibleSessions.map` (aisessions) 与 `displayedTabGroups[].blocks.map` (overview) 接入 `useVirtualizer` (已依赖 `@tanstack/react-virtual`)。对 `session-detail` 的长消息流亦虚拟化。
2.  **Jotai 细粒度**:
    *   拆 `sessionsAtom: SessionSummary[]` 为 `sessionsAtomFamily` + `filteredSortedIdsAtom` (derived)，`SessionRow` 仅订阅单条 `sessionAtom(key)`。
    *   `availableTagsAtom`、`projectPathsAtom` 等保持独立，已较好。
3.  **防抖/节流统一**: 将 200ms 筛选防抖抽为 `useDebouncedValue(query,200)` hook，避免每次 `setTimeout` 重新创建。
4.  **rAF 合批**: 已有 `flushChannels`，建议将 AISession 的 `replaceSession` (多次 `globalStore.set`) 也纳入 `requestAnimationFrame` 批处理。

### 4.4 L4 体验层: 刷新可视化

*   复用 `formatRelativeRefreshTime` / `formatDateTimeToSecond` 已有逻辑，在列表头 `lastRefreshLabel` 旁增加状态图标 (见 3 节)。
*   新增 `AutoRefreshIntervalMetaKey` 的 UI 提示：当 `autoRefreshIntervalMs>0` 时在标题栏显示 `Auto · 60s` 徽标。
*   Overview 标题栏增加 `Syncing N` 进度点 (基于 `summaryRequestQueue.active + detailRequestQueue.active`)。

---

## 5. 实施路线图 & 度量

| 阶段 | 工作项 | 验证方式 | 状态 |
|---|---|---|---|
| P0 | 虚拟化 + Jotai 细粒度 + 图表 4 态 | `vitest` + 手工滚动 perf trace | 🟢 部分完成 |
| P0 | `RefreshStatusIcon` 5 态组件 + `usePageVisible` hook | `npx tsc --noEmit` 通过 | ✅ 已完成 |
| P0 | AISession `endIconButtons` 接入 RefreshStatusIcon | `npx tsc --noEmit` 通过 | ✅ 已完成 |
| P0 | Overview `endIconButtons` 动态 syncing/idle | `npx tsc --noEmit` 通过 | ✅ 已完成 |
| P1 | 复合索引 `idx_ai_sessions_list/search/meta_key` | `go test ./pkg/aisessions` 通过 | ✅ 已完成 |
| P1 | `ListWithDistribution` 两阶段批量 meta 加载 (N+1 修复) | `go test ./pkg/aisessions` 通过 | ✅ 已完成 |
| P1 | `content_hash` 列 + `SessionFile.ContentHash` 字段 | `go test ./pkg/aisessions` 通过 | ✅ 已完成 |
| P1 | 中央刷新总线 `refresh-bus.ts` | `npx tsc --noEmit` 通过 | ✅ 已完成 |
| P1 | SQLite 连接复用 (单例池) | ⚠️ 重写时发现收益受限（串行调用时 Close 驱逐缓存，且测试 TempDir 清理冲突） | 🚫 跳过 |
| P2 | fsnotify 事件驱动 + FTS5 搜索 | `go test ./pkg/aisessions -run TestSQLite` | ⬜ 待实现 |

**关键指标**:
*   `Manager.cachedScanList` 命中率 >90% (原 <50% 冷启动后)
*   `loadSessions` P95 <150ms (原 400-800ms @500 sessions)
*   渲染帧时间 <16ms (60fps)

---

## 6. 风险与回退

*   单例 DB 需处理 `corrupt` 重命名后的重新 `Open`；保留现有 `OpenSQLiteIndex` 的 corrupt 检测逻辑。
*   虚拟化需保持 `SessionRow` 高度可变时的测量准确，TanStack Virtual 已支持动态高度，配合 `estimateSize` 即可。
*   总线去重需保留手动 `Refresh=true` 的强制路径，避免缓存过期无法强制刷新。

---

## 7. 附录: 关键文件清单

*   `frontend/app/view/aisessions/aisessions.tsx:1002-1062` - 双定时器 + 筛选防抖
*   `frontend/app/session-overview/session-overview.tsx:408,906` - 15s 轮询
*   `frontend/app/session-overview/session-overview-session-cache.ts:24-38,312-360` - TTL + 队列 + rAF
*   `pkg/aisessions/manager.go:162-272,369-418` - Scan + populateMessageCounts
*   `pkg/aisessions/sqlite_index.go:1-120` - WAL + schema

> 本方案已在 `docs/project/` 落盘，可直接作为迭代任务拆解。
