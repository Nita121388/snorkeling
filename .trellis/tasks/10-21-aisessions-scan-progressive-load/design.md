# 技术设计：扫描内存治理与渐进式加载

## 1. 问题建模

崩溃不是"单个文件太大"导致，而是三条链路叠加：

```
overview 每 15s 轮询 Summary (并发 4)
        └─> resolveSession: 缓存行 mtime/size 不匹配
              └─> ScanSummaries(全量, 无 singleflight)      ← N 路并行
                    └─> PiProvider.List 1617 文件 / 2.7GB
                          └─> scanTitle 全文顺序扫（无闸门）
List RPC ─> ScanListWithDistribution
        └─> populateMessageCounts: 对 limit 内每条 LoadMessages（无预算）
```

放大器是**并发重复 + 无预算**，不是单次分配。因此第一优先级是"同一时刻只有一个全量扫描"，
第二优先级是"能从缓存出结果就别扫"。

## 2. 边界与分层

| 层 | 文件 | 职责 |
|---|---|---|
| 扫描协调 | `pkg/aisessions/scancoordinator.go`（新增） | singleflight、时间预算、进度回调、结果快照 |
| 列表编排 | `pkg/aisessions/manager.go` | `ScanListResult`：缓存优先 / 后台补全 / 预算 |
| 解析闸门 | `pkg/aisessions/provider_pi.go`, `provider_codex.go`, `util.go` | 文件大小闸门、mtime 倒序、行上限 |
| 服务层 | `pkg/service/aisessionsservice/aisessionsservice.go` | 响应字段、wps 事件发布 |
| 前端 | `frontend/app/view/aisessions/*` | 骨架行、进度条、事件订阅、防抖刷新 |

`pkg/aisessions` **不** import `wps`；进度以回调形式暴露，由 service 层转事件，保持包依赖干净
（与现有 `Manager.Progress` 无耦合，新增 `ManagerOptions.OnScanProgress`）。

## 3. 核心契约

### 3.1 扫描协调器

```go
// scancoordinator.go
type ScanOptions struct {
    Budget   time.Duration // 0 => summaryScanBudget（默认 8s）
    Progress func(ScanProgress)
}

type ScanProgress struct {
    Source  string
    Scanned int
    Total   int
    Running bool
    Done    bool
    Partial bool // 预算耗尽提前结束
}

// 同一 scanKey 全进程只有一个 goroutine 在扫；其余调用方等待同一结果。
func (m *Manager) ScanAllSummaries(ctx context.Context, opts ScanOptions) ([]SessionSummary, []error)

func (m *Manager) scanKey() string // SQLitePath + 排序后的 provider sources
```

实现要点：
- 包级 `scanFlights map[string]*scanFlight`（`scanFlight{done chan struct{}, summaries, errs, partial}`），
  `start` 者在 goroutine 内扫；`join` 者 `select` 等待 `done` 或 `ctx.Done()`。
- 扫描主体仍用 `ScanSummaries`，但传入**可取消 ctx + 预算 ctx**；`ScanSummaries` 已有 `ctx.Err()` 检查，
  预算取消后返回已有部分结果。
- `partial=true` 时**不**写 `HasSummaryScan` 完成标记（沿用 `SaveScannedSummaries(..., complete)` 语义）。
- 结束立刻清 map 条目，避免长期驻留内存。

### 3.2 `resolveSession` 语义调整

```
resolveLiveSession            → 命中直接返回（保持）
SQLite 有行（requireCurrent=false）
    ├─ 文件 mtime/size 一致   → 直接返回
    └─ 不一致                 → 立即返回该旧行 + refreshSummariesInBackground(identifier)（已有 singleflight）
SQLite 无行
    └─ ScanAllSummaries（singleflight + 预算）→ 匹配 → 保存 → 返回
```

对齐 `Manager.Summary(refresh=true)` 的既有做法（L640-648），把"旧行 + 后台刷新"变成默认，
不再走同步全量扫。差别仅在 `refresh=false` 时也允许返回**可能过期**的行——列表/详情本来就有
mtime-driven 的增量刷新兜底。

### 3.3 列表编排 `ScanListResult`

```go
type ScanListResult struct {
    Sessions     []SessionSummary
    ProjectPaths []ProjectPathSummary
    Scanning     bool
    Scanned      int
    Total        int
}

func (m *Manager) ScanListResult(ctx context.Context, opts ListOptions, query string) (ScanListResult, error)
```

分支：

| 情形 | 行为 |
|---|---|
| `HasSummaryScan == true` 且 `!Refresh` | 走现有 `cachedScanListWithDistribution`（增量 `refreshChangedSummaries`，只解析变更文件）；`Scanning=false` |
| `HasSummaryScan == false` 或 `Refresh` | 立刻从 SQLite 现有行出结果（`ListWithDistribution`），返回 `Scanning=true`；后台 `ScanAllSummaries`（预算 8s → 若未完成继续下一轮直到完成），边扫边发进度 |

`ScanListWithDistribution` 保留为兼容包装（现有测试不改），内部调用 `ScanListResult`。

### 3.4 `populateMessageCounts` 预算

新增 `messageCountBudgetBytes`（默认 128MB / 次调用，env 可调）：

- 每条 summary：先查 SQLite `GetMessages`（已有，命中则零解析）
- 未命中则 `LoadMessages`，并累计 `len(text)+len(thinking)`
- 累计超预算 → 后续 summary **不再解析**，保留其已有 `MessageCount`（来自 `ai_sessions.message_count`）
- 这样最坏情况内存被硬性钳在预算内

### 3.5 解析闸门

- `summaryParseMaxFileBytes`（默认 32MB，env `SNORKELING_AISESSIONS_SCAN_MAX_FILE_BYTES`）：
  超过则 `scanTitle` 跳过、直接 `ProjectPath` basename 作标题；仍保留 head/tail 得出的时间与 snippet
- `scanTitle` 增加读取上限 `titleScanMaxBytes`（默认 1MB）：读满即返回已得结果，避免全文扫
- `sessionFilesFromPaths`：收集后按 `MTime` **倒序**排序（一次排序，所有 provider 共享）

### 3.6 进度事件（wps）

```go
// pkg/wps/wpstypes.go
Event_AISessionsScanStatus = "aisessions:scanstatus" // type: *aisessions.ScanStatusEvent

// pkg/aisessions/types.go
type ScanStatusEvent struct {
    Connection string `json:"connection,omitempty"`
    Scanned    int    `json:"scanned"`
    Total      int    `json:"total"`
    Running    bool   `json:"running"`
    Done       bool   `json:"done"`
    Partial    bool   `json:"partial,omitempty"`
}
```

service 层在 `managerForConnection` 之后注入 `OnScanProgress`，把回调转成
`wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_AISessionsScanStatus, Data: ev})`，
节流：≥200ms 或扫描数变化 ≥50 才发一次，避免事件风暴。

### 3.7 响应契约（TypeScript 由 tsgen 生成）

```go
type AISessionsListResponse struct {
    Sessions     []aisessions.SessionSummary
    ProjectPaths []aisessions.ProjectPathSummary
    Scanning     bool  // 新增
    Scanned      int   // 新增
    Total        int   // 新增
}
```

不带 `omitempty`，保证前端拿到稳定的 `scanning:false`。

### 3.8 前端

- `aisessions.tsx`
  - `loadSessions` 读响应写入 `scanningAtom` / `scanProgressAtom`
  - 列表尾部：`scanning` 时渲染 `SkeletonSessionRow × 6`（新组件，复用 `session-row.tsx` 的行高与缩进）
  - 顶部/底部一条 `ScanProgressStrip`：`正在同步 320/1617…`，`Done` 后 300ms 淡出
  - `waveEventSubscribeSingle({eventType: "aisessions:scanstatus"})`：
    - progress → 只更新进度 atom
    - done → 防抖 400ms 后 `loadSessions(false)`
  - 卸载时退订；只在本地连接（`connection === ""`）订阅
- `session-row.tsx` 抽出 `SessionRowFrame`（骨架与真实行共用外壳），避免样式漂移
- 骨架行必须 `aria-hidden`，进度条用 `aria-live="polite"`

### 3.9 详情帧复用（P2）

包级 `sessionMessageCache`：`map[key]entry{summaryMTime, summarySize, messages}`，LRU 2 条 +
`96MB` 字节预算（按 `len(Text)+len(Thinking)` 计）。`loadMessages` 读写该缓存；
`loadAllDelta` 因此不再每帧读整会话。`SessionSummary.MTime/Size` 变化即失效。

## 4. 权衡

| 决策 | 代价 | 理由 |
|---|---|---|
| 允许返回过期 summary 行 | 极端情况标题/条数短暂滞后（≤1 次后台刷新） | 换掉同步全量扫；已有事件/轮询会在数百 ms 内修正 |
| 全量扫预算 8s + 后台续扫 | 冷启动时列表分两批出现 | 保证 UI 永远先有结果；骨架行掩盖体验 |
| singleflight 让并发请求等同一个扫描 | 单次等待上限 = 预算 | 相比 N 路并行 OOM，等待可接受；预算保证等待有界 |
| 消息计数预算法 | 超预算会话条数暂时显示旧值 | 条数是次要信息，不值得 OOM 风险 |
| 包级 flight 缓存以 SQLitePath 为 key | 多 profile 共用路径时会串 | 现有 `DefaultSQLiteIndexPath()` 每 profile 唯一 |

## 5. 兼容与回滚

环境变量开关（默认新行为）：

- `SNORKELING_AISESSIONS_BLOCKING_SCAN=1` → `ScanListResult` 退回同步全量扫（旧行为，仅用于排查）
- `SNORKELING_AISESSIONS_SCAN_BUDGET_MS`（默认 8000）
- `SNORKELING_AISESSIONS_SCAN_MAX_FILE_BYTES`（默认 33554432）
- `SNORKELING_AISESSIONS_TITLE_SCAN_MAX_BYTES`（默认 1048576）
- `SNORKELING_AISESSIONS_MSG_BUDGET_BYTES`（默认 134217728）

回滚：全部改动集中在 `pkg/aisessions` + service 的一个响应字段 + 前端 aisessions 视图；
`git revert` 单 commit 即可，无数据迁移、无 schema 变更。

## 6. 测试策略

单元测试（`pkg/aisessions`）：
1. `TestScanAllSummariesSingleflight`：10 并发调用 → fake provider 只被调用 1 次
2. `TestScanAllSummariesBudgetPartial`：provider 慢速产出 → 预算到期返回部分 + `Partial=true`
3. `TestResolveSessionStaleCacheFastPath`：缓存行 mtime 不符 → 立即返回且 fake provider 调用数 0
4. `TestResolveSessionNoRowScans`：无缓存行 → 走扫描并保存
5. `TestSessionFilesNewestFirst`：乱序 mtime → 倒序
6. `TestPopulateMessageCountsBudget`：预算内/超预算两种输入
7. `TestScanTitleRespectsByteCap`：超大文件提前返回

服务层：`TestListReturnsScanningFlag`（fake manager 或 build tag 跳过）。

前端：`frontend/app/view/aisessions/scan-progress.test.tsx`
- `scanning=true` 渲染骨架行 + 进度文案
- 收到 `done` 事件后触发一次 `loadSessions(false)`（fake timers 验证防抖与只调用一次）

回归：现有 `pkg/aisessions/*_test.go` 与 `frontend` 相关 vitest 必须全绿。
