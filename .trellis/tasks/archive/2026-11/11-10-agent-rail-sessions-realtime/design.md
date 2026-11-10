# 技术设计

## R1 水平滚动轴

`frontend/app/view/session-outline-rail.tsx`：
1. 滚动容器 className `overflow-y-auto max-h-[300px] scrollbar-hide-until-hover`
   → 加 `overflow-x-hidden`（CSS 单轴非 visible 会把另一轴强制成 auto）。
2. `RailTick` 外层宽度从固定 `width: RAIL_WIDTH` 改为 `w-full` + `maxWidth: RAIL_WIDTH`：
   出现 4px 竖滚动条时内容区只剩 32px，子项跟着收缩，`scrollWidth == clientWidth` 不变量成立。
   刻度左对齐、最宽药丸 26+4=30px < 32px，不会被裁。
GUI 会话详情与 TUI rail 共用此组件，一并修好。

## R2 刻度轨实时化（frontend/app/view/term/term-agent-message-rail.tsx）

现状：`refreshOutline` 只在 `useEffect(..., [connection, refreshOutline, sessionId])` 里跑一次。
新会话首拉必然空 → 永久停滞。

### 新的刷新调度（全在组件内，不新增全局 store）

```
refreshOutline(force: boolean)
  loadUserOutline(service, sessionId, { connection, limit: 50, forceRefresh: force })
    .then(setOutline)   // 空结果也照常 set（触发下面的自适应轮询）
```

三层触发，共用一个 `scheduleRefresh(delayMs, force)` 帮助函数（clearTimeout + setTimeout，
组件卸载 / sessionId 变化时统一清理）：

1. **挂载 / sessionId 变化**：立即 `refresh(false)`（允许吃 30s TTL 缓存）。
2. **自适应轮询**（替代「拉一次就停」）：
   - 结果为空（0 条 user 消息）→ 3s 后 `refresh(true)` 快速重试（新会话第一条消息落盘前的窗口期）。
   - 快速重试连续超过 `FastRetryMaxAttempts = 40`（约 2 分钟）后降级为慢轮询，
     避免「用户只是开着 agent 没说话」时空转打 RPC。
   - 结果非空 → 30s 后 `refresh(false)` 慢轮询（TTL 30s ≈ 每次都真实落盘；无 hook 的 provider 靠它兜底）。
   - `document.visibilityState === "hidden"` 时暂停（计时器照常触发，触发时发现 hidden 就只重排下一轮）。
3. **agentstatus 事件驱动**：`waveEventSubscribeSingle({ eventType: "agentstatus", scope: makeORef("block", blockId) })`
   ——每次 turn 后 hook 上报都会来事件 → 去抖 800ms 后 `refresh(true)`（forceRefresh 绕过 TTL）。
   事件风暴保护：距上次 forced 刷新 < 2s 时只重排 2s 后再来。

sessionId 变化时：清 outline state、清全部计时器、重走第 1 层。
错误路径：RPC 失败按「空结果」处理（继续重试链），沿用现有 `.catch(() => undefined)` 的静默风格但记 debug。

### 不做什么

- 不把 outline 提升为全局 store：单块消费，组件内闭环即可。
- 不改 `outline-cache.ts` 的 TTL/接口；forceRefresh 已有通道。

## R3 会话列表实时（方案 A：后端检测 + 事件推送）

### 后端

**新事件**（`pkg/aisessions/types.go` + `pkg/wps/wpstypes.go` + `pkg/tsgen/tsgenevent.go`）：

```go
Event_AISessionsSessionsChanged = "aisessions:sessionschanged"
type SessionsChangedEvent struct {
    Connection string `json:"connection,omitempty"`
    Changed    int    `json:"changed,omitempty"` // 本次检测到的变更/新增会话文件数
    At         int64  `json:"at,omitempty"`      // unix ms
}
```

**变更检测**（`pkg/aisessions/manager.go`）：

```go
// DetectChangedSessionFiles: stat-only 变更检测，不 parse 会话文件。
// 复用 cachedScanListWithDistribution 里 refreshChangedSummaries 的前半段：
// ListFiles + MarkMissingSourceFiles + ChangedFiles，只在有变更时返回计数。
func (m *Manager) DetectChangedSessionFiles(ctx context.Context) (int, error)
```

关键点：**watcher tick 只做 stat（列目录 + 比对索引里的 mtime/size），不 parse**。
真正 parse 发生在前端收到事件后的 List RPC（refreshChangedSummaries 的既有路径），
成本模型与现状一致，只是触发时机提前。

**watcher 单例**（`pkg/service/aisessionsservice/aisessionsservice.go`）：

- `ensureLocalSessionsWatcher()`：`sync.Once` 包一个 `time.Ticker`，默认 5s
  （env `WAVETERM_AI_SESSIONS_WATCH_INTERVAL_MS` 覆盖，≤0 关闭，方便应急止血）。
- 每个 tick：`newLocalManager()`（沿用现状的每请求新建 manager 模式，不做长生命周期连接池）→
  `DetectChangedSessionFiles(ctx 10s)` → count > 0 → `makeSessionsChangedPublisher("")` 发布。
- 发布器 2s 节流（活跃会话每条消息都改 mtime，防事件风暴；被节流的发布丢弃，
  下一个 tick 有变更会再发）。
- 懒启动：本地连接的 `List` / `Search` 首次调用时启动；进程生命周期内常驻，不做 stop。
  watcher 只服务本地（远程 provider 文件在远端，检测不到）。

### 前端（frontend/app/view/aisessions/aisessions.tsx）

新增订阅（与现有 `aisessions:titleupdated` 订阅同一模式）：

```tsx
useEffect(() => {
    return waveEventSubscribeSingle<"aisessions:sessionschanged">({
        eventType: "aisessions:sessionschanged",
        handler: (event) => {
            if (event.data?.connection) return;          // 只消费本地
            if (!blockVisible || document.visibilityState === "hidden") return;
            // 事件去抖 + 最小间隔 5s（防 mtime 风暴下连环全量 List）
            debounce(500ms, () => minInterval(5s, backgroundRefresh));
        },
    });
}, [model, blockVisible]);
```

`backgroundRefresh` = 复用现有 60s 轮询 tick 的方法体（`loadSessions(false, sort, true)` +
`refreshBoundSessionSummary()` + 打开的 detail 走 `loadDetailDelta("manual")`），抽成 useCallback。
60s 轮询保留不动，作为事件链故障时的安全网。

### 权衡记录

- **tick 轮询 vs fsnotify**：fsnotify 已在 go.mod，但要盯各 provider 的多层会话根目录
  （codex 按日期分桶、claude 按项目分目录、opencode 全在一处），目录集合还随 provider 配置变。
  5s stat 轮询的实现量小一个量级、无 watch 泄漏面，且 stat-only 成本可控（目录列表 + 索引比对）。
  如果实测 tick 成本高，后续可在同一 `DetectChangedSessionFiles` 接口下换 fsnotify 实现，前端无感。
- **事件只带计数不带行数据**：列表刷新走既有 List RPC（筛选/排序/attach 上下文都在后端一处算），
  事件只做触发信号，避免两套行组装逻辑。

## 兼容与回滚

- R3 事件是新增：老前端不认识该事件，忽略；新前端在老后端上订阅不到 → 60s 轮询兜底。双向安全。
- 全部改动一个 commit，出问题 revert 即回滚。
- env 开关：`WAVETERM_AI_SESSIONS_WATCH_INTERVAL_MS=0` 可彻底关掉 watcher。

## 真机验证

- 新 verify area `scripts/verify/agent-session-rail/`（CDP attach）：
  1. `.term-agent-msg-rail` 滚动容器 computed `overflowX === "hidden"` 且 `scrollWidth <= clientWidth`（R1）。
  2. GUI 会话详情 rail 同断言（同一组件第二挂载点）。
  3. 新建 agent 会话首条消息后轨道出现（R2 端到端）——依赖真实 agent CLI，允许 `--attach` 模式下
     人工建会话后跑断言；干净实例模式写 skipped 并给原因。
- R3 端到端：`--attach` 下对运行中 agent 发一条消息，观察列表行 ≤10s 更新（或按 verify 台
  实际可自动化程度落地，做不到的进 skipped）。
- 单测：R2 调度器（fake timers）、R3 `DetectChangedSessionFiles`、发布节流、事件类型映射
  （`node scripts/run-task.mjs generate` 后 tsc 通过即覆盖）。
