# AI Sessions 扫描与加载契约（后端）

> 适用范围：`pkg/aisessions`、`pkg/service/aisessionsservice`。
> 来源：2026-10-21 `aisessions-scan-progressive-load` 任务（wavesrv 因 AI 会话扫描 OOM 崩溃）。

## 为什么有这个契约

会话历史很容易积累到几千个文件（本机实测：`~/.pi/agent/sessions` 2.7GB / 1547 个 jsonl，
`~/.codex/sessions` 1.4GB / 3524 个会话）。一次"全量 summary 扫描"要遍历所有文件读头尾。
历史上三条链路叠加把 wavesrv 打到 Windows 提交上限：

```
overview 每 15s 轮询 Summary（并发 4）
  └─> resolveSession 缓存行 mtime 不匹配 → ScanSummaries（无 singleflight，N 路并行）
List RPC
  └─> populateMessageCounts 对 limit 内每条 LoadMessages（无预算）
```

结果为 `fatal error: out of memory`，前端表现为"AI 会话加载失败"。
**结论：问题不是单个文件过大，而是并发重复 + 无预算。**

## 必须遵守的不变量

### 1. 全量扫描必须 single-flight 且有预算

- 新代码**不得**直接调用 `ScanSummaries`；走 `Manager.ScanAllSummaries`（或 `refreshAllSummaries`）。
- 同一 `scanKey()`（SQLitePath + provider sources）全进程同时只允许一个扫描在跑，
  并发调用方 join 同一个 flight 等待结果。
- 扫描有 `summaryScanBudget`（默认 8s，`SNORKELING_AISESSIONS_SCAN_BUDGET_MS`）；预算到期返回部分结果，
  `partial=true` 且**不得**写 `HasSummaryScan` 完成标记。
- 扫描跑在 background ctx 上：调用方的 RPC ctx 取消不应中止共享扫描（仍有预算兜底）。

### 2. 新鲜度契约：轮询可以旧，详情必须新

| 入口 | `resolveSession` 的 allowStale | 理由 |
|---|---|---|
| `Summary`（GUI 轮询） | `true` | 缓存行存在但文件变了 → 立即返回旧行，不触发同步全量扫 |
| `Load` / `LoadDelta` / `Path` / 删除 / 元数据写入 | `false` | 需要文件当前 mtime/size，否则消息缓存不会失效（`TestManagerLoadUsesSQLiteMessageCache` 守这条） |

改 `resolveSession` 的签名/语义时，先看这两类调用方，别一刀切成 stale 或一刀切成强一致。

### 3. 列表用 `ScanListResult`，不要绕过它

- 缓存命中（`HasSummaryScan`）→ 走增量 `refreshChangedSummaries`，`Scanning=false`。
- 冷索引 → 一次有预算的同步扫描；预算耗尽则返回部分结果 + `Scanning=true`，后台补完。
- `ScanListWithDistribution` 只是兼容包装，新代码用 `ScanListResult`。

### 4. 内存预算

- 扫描顺序：文件按 **mtime 倒序**（`sessionFilesFromPaths`），最新会话先入库。
- 单文件闸门：超过 `summaryParseMaxFileBytes`（默认 32MB）跳过全文 title 扫描，标题回退 project basename；
  `scanTitle` 自身还有 `titleScanMaxBytes`（默认 1MB）读取上限。
- 消息计数：`populateMessageCounts` 单次调用受 `messageCountBudgetBytes`（默认 128MB）约束，
  超预算的会话保留索引里已有的 `MessageCount`，不解析正文。

### 5. 进度事件

- 事件名 `aisessions:scanstatus`（`wps.Event_AISessionsScanStatus`），payload `aisessions.ScanStatusEvent`。
- `pkg/aisessions` **不** import `wps`：进度通过 `ManagerOptions.OnScanProgress` 回调暴露，
  由 service 层转事件（节流：≥200ms 或 scanned 增量 ≥50）。
- 前端只消费 `connection === ""` 的事件；进度更新不触发重新拉列表，`done` 才防抖重取。

## 回滚开关

| 环境变量 | 作用 |
|---|---|
| `SNORKELING_AISESSIONS_BLOCKING_SCAN=1` | 恢复旧行为（同步、可并发的全量扫），仅用于排查 |
| `SNORKELING_AISESSIONS_SCAN_BUDGET_MS` | 同步扫描预算（默认 8000） |
| `SNORKELING_AISESSIONS_SCAN_MAX_FILE_BYTES` | 单文件解析闸门（默认 32MB） |
| `SNORKELING_AISESSIONS_TITLE_SCAN_MAX_BYTES` | title 扫描读取上限（默认 1MB） |
| `SNORKELING_AISESSIONS_MSG_BUDGET_BYTES` | 消息计数解析预算（默认 128MB） |

## 改动检查清单

- [ ] 新增扫描路径是否走 `ScanAllSummaries`？有没有直接调 `ScanSummaries`？
- [ ] 是否有可能在同一 scanKey 上并行起两个全量扫描？
- [ ] 预算耗尽时是否会误写 `HasSummaryScan` 完成标记？
- [ ] 详情路径（Load/Delta）是否仍拿到当前 mtime/size？
- [ ] `go test ./pkg/aisessions/...` 是否包含 singleflight / 预算 / stale 快返回 / mtime 倒序用例？
- [ ] 前端动到 `aisessions.tsx` 时，`vitest run frontend/app/view/aisessions` 是否全绿？
