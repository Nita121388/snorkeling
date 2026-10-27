# Design: AI Audit 界面整改

## 1. 现状与目标差距

| 维度 | 现状 | 目标 |
|---|---|---|
| 宽度 | 根节点缺 `w-full`，内容按 max-content 收缩 | 占满 `.block-content` |
| 列 | 8 列，Feature/Source/Session 冗余，Result/Duration 无含义 | 7 列 + 自解释标签 |
| 状态 | 纯文字 + 图标，失败无底色 | 状态胶囊 + 行级染色 + stuck 标记 |
| 筛选 | 缺 queued/running | 5 态全量 |
| 分页 | 固定 limit 100 | Load more（offset 递增） |
| 统计 | 不随轮询刷新，avg 含 0ms | 随列表刷新 + 正确口径 + 24h 迷你柱状图 |
| 详情 | 纯文本弹窗，无截断提示，ESC 不关 | 右侧 Drawer + 三 Tab + 截断提示 |
| 危险操作 | 一键删除 | 二次确认 + 结果回报 |
| 键盘 | 不可达 | Tab/Enter/Space + Esc |

## 2. 前端结构（`frontend/app/view/aiaudit/`）

### 2.1 组件拆分

```
aiaudit-view.tsx
├─ AiAuditView               根：layout + 分页状态
├─ AuditToolbar              搜索 / 两个筛选 / Refresh / Clear(二次确认)
├─ AuditStatsStrip           3 metrics + 24h sparkline + 可点 failed
├─ AuditTable
│  ├─ AuditDayHeader         日期分隔（sticky）
│  ├─ AuditRow               胶囊 / 双行 Session / 行级染色 / 键盘
│  └─ AuditLoadMore
├─ AuditDetailDrawer         Summary | Request | Response
└─ AuditRawPane              复用现有 AuditRawBlock（Copy/Expand）
```

纯函数抽到 `aiaudit-format.ts`（可单测）：
`formatDuration` / `formatClock` / `dayKey` / `dayLabel` / `stateMeta(state)` /
`isStuck(entry, now)` / `resultLabel(entry)` / `shortSessionKey(key)` / `bucketHeight(bucket, max)`。

### 2.2 布局修复

根节点：`flex h-full w-full min-h-0 flex-col bg-block-solid text-primary`。
`.aiaudit-root` 加 class 便于 CDP 验收。表格容器 `overflow-auto`，`table` 用
`w-full table-fixed` + `colgroup` 固定列宽，避免长 session 撑破：

```
col: Time 104 | Feature 168 | Session auto(min 240) | State 96 | Result 92 | Duration 76 | Actions 64
```

`table-fixed` 下超长文本靠 `truncate` + `title` 兜底。

### 2.3 信息架构

- **Feature 列**：`Timeline` 主文本 + 下一行 muted 小字 `auto scan`（scope 映射自 `SourceLabels`）。
  删除独立 Source 列。
- **Session 列**：第一行 `sessionTitle || "Untitled session"`；
  第二行 muted `shortSessionKey(key)`（形如 `db0b044e…c012a886`）+ model 徽标（`aiModel` 非空时）。
- **State 列**：胶囊 = 8px 圆点 + 文本；颜色
  done→success、failed→error、queued→warning（>30min 时文案 `stuck`，error 色带虚线边框）、
  running→accent、cancelled→secondary。
- **Result 列**：`3` + `title="3 results · anchors 1/5 kept"`；有 anchors 时显示 `1/5` 第二行 muted。
  queued/running 显示 `—`。
- **Duration 列**：`tabular-nums`，右对齐；未完成显示 `—`。
- **Actions 列**：默认透明，`group-hover`/focus 显现 Retry（失败）与 chevron。

### 2.4 行样式

```
tr.aiaudit-row            hover:bg-hover, focus-visible:ring-1 ring-accent
tr.aiaudit-row.is-failed  bg-error/8 + 左侧 2px error 竖条（border-l-2 border-error）
tr.aiaudit-row.is-stuck   bg-warning/8 + 左侧 2px warning 竖条
tbody tr:nth-child(even)  bg-white/[0.015]（斑马纹，用 color-mix 或 rgba 也行）
```
斑马纹 + 状态底色冲突：状态底色优先，斑马纹只作用于 `:not(.is-failed):not(.is-stuck)`。

行语义：`role="button" tabIndex={0}`，`onKeyDown` 处理 Enter/Space。

### 2.5 分页

model 增加 `pageAtom`（offset）与 `hasMoreAtom`。
- `load({ mode: "reset" })` → offset 0，覆盖 entries。
- `load({ mode: "append" })` → offset = entries.length，追加。
- 轮询（4s / 事件）只在 `offset === 0` 时刷新（否则会在翻页中途把列表重置）；
  分页状态下自动刷新降级为「新事件到达时提示 New entries」——本期简化为：分页后暂停自动刷新，
  顶部显示 `Refresh to see new entries`。
- `document.hidden` 时跳过轮询。

### 2.6 统计刷新

`loadStats()` 独立函数 + `lastStatsAt` 节流（≥10s）。
`load(reset)` 首次与手动 Refresh 都调用 `loadStats()`；轮询路径在节流窗口外也调用，
不再出现「统计永远停在首屏」。

### 2.7 Clear 二次确认

`clearArmedAtom: boolean`：
1. 第一次点击 → 按钮变危险色文案 `Clear 30d?` + 3s 后自动复原；
2. 第二次点击 → 调 `AuditClear`，返回 `removed` 数，toolbar 下方显示
   `Cleared N entries older than 30 days`（10s 后淡出）。

后端 `AuditClear` 已返回 removed，`aiaudit-model.clear()` 改为返回该值。

### 2.8 详情 Drawer

- 右侧滑出：`fixed inset-y-0 right-0 w-[min(640px,calc(100vw-2rem))]`，
  遮罩 `fixed inset-0 bg-black/40`，portal 到 `#main`（沿用现有注释里的原因）。
- 头部：Feature · state 胶囊 · session 双行 · 关闭按钮。
- Tab：`Summary | Request | Response`（本地 state，默认 Summary）。
- Summary：定义列表网格（label 96px / value），字段：
  Feature、Scope、Trigger、Model、Connection、State、Results、Anchors、Duration、Created、Job ID（可 copy）。
  `error` 非空时在顶部显示 error banner。
- Request/Response：复用 `AuditRawBlock`；`rawTruncated` 为真时在 pane 顶部显示
  黄色提示 `Payload truncated — only the first 64KB is stored.`
- ESC 关闭（`useEffect` 监听 keydown）、点击遮罩关闭。
- 打开时 `detailLoading` 用骨架行替代旧的右下角 toast。

### 2.9 统计条

```
24h  [ 20 calls ]  [ 3 failed ]  [ avg 7.2s ]   [sparkline: 24 bars]   Timeline 14 · Note & Tags 6
```
- metric 数字 13px/600，标签 10px muted；failed>0 时整块 error 色并且可点击 → 设置 state 筛选。
- sparkline：24 个 3px 宽竖条，高度按 `count / max` 归一化（min 2px），
  failed 占比高的桶用 error 色，其余 accent/40；`title` 显示 `14:00 · 3 calls · 1 failed`。

## 3. 后端改动（`pkg/aisessions/audit_store.go`）

### 3.1 搜索大小写

```
pattern := "%" + strings.ToLower(query) + "%"
where: (LOWER(session_title) LIKE ? OR LOWER(error) LIKE ? OR LOWER(ai_model) LIKE ? OR LOWER(session_key) LIKE ?)
```
新增 `session_key` 参与搜索（用户常粘贴 key 片段）。

### 3.2 统计口径

`AVG(CASE WHEN duration_ms > 0 AND state='done' THEN duration_ms END)`；
`Failed24h` 保持；新增 `Done24h`（已有）。

### 3.3 24h 小时桶

```go
type AuditHourBucket struct {
    Hour      int64 `json:"hour"`      // 该小时起点 UnixMilli
    Count     int   `json:"count"`
    Failed    int   `json:"failed"`
}
// AuditStatsResult 增加 Hourly []AuditHourBucket `json:"hourly"`
```
SQL：`SELECT created_at FROM ai_audit_log WHERE created_at >= ?`（24h，量级小），
Go 侧按 `created_at/3600000` 聚合，固定输出 24 个桶（缺省 0），保证前端柱状图稳定。

### 3.4 僵尸 queued 回收

```
const auditStaleMs = 30 * 60 * 1000
UPDATE ai_audit_log
   SET state='failed', error='orphaned: completion callback never arrived', updated_at=now
 WHERE state='queued' AND created_at < now-30min
```
调用点：`SQLiteIndex.AuditStats` 之前（`Manager.AuditStats` 内），用进程内
`atomic.Int64 lastSweep` 做 60s 节流。选择 Stats 而非 List：Stats 只在显式/节流刷新时调用，
避免每次翻页都写库。

被回收的行在下次列表加载即可见为 `failed`，`Retry` 可用（复用现有 retry 路径）。

### 3.5 生成物

改完 Go 结构后跑 `node scripts/run-task.mjs generate` 同步
`frontend/types/gotypes.d.ts` 与 `frontend/app/store/services.ts`。

## 4. 风险与取舍

| 风险 | 处置 |
|---|---|
| `table-fixed` + 窄浮层会挤压 Session 列 | `min-w-[240px]` + 横向滚动兜底（容器 `overflow-auto`） |
| 30min 阈值误杀长任务 | AuditBegin 在执行开始时写入，AI 调用超时 90s + 重试退避 <2min；30min 裕度足够 |
| 分页与轮询冲突 | 分页后暂停自动刷新，显式 Refresh 重置到第一页 |
| 生成文件手改 | 只通过 `task generate` 产出，diff 只应含新增字段 |
| 斑马纹与状态底色冲突 | 状态底色优先，斑马纹仅作用于正常行 |
| 4s 轮询打 DB | 保留 4s，但 `document.hidden` 跳过；Stats 走 10s 节流 |

## 5. 验证方式

- 前端单测（新增 `aiaudit-format.test.ts`）：stuck 判定、state 映射、session key 缩写、桶高归一化。
- 后端 `go test ./pkg/aisessions/`：新增 `TestAuditStaleSweep`、`TestAuditSearchCaseInsensitive`、
  `TestAuditStatsHourlyBuckets`（用内存 SQLite，参照现有 audit 测试写法）。
- CDP 实测（若 app 可启动）：`node scripts/inspect-electron-ui.mjs state` 检查
  `.aiaudit-root` 宽度与表格宽度一致。
