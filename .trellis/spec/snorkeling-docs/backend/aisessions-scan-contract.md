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

## 新增扫描 provider 的前端联动（踩坑 2026-11-09）

后端新增 provider（如 `provider_opencode.go` 的 `SourceOpenCode`）后，筛选栏不会自动支持它：

- 筛选栏 agent 来源段直接 `CHAT_SOURCES.map(...)` 渲染（`frontend/app/view/aisessions/filter-panel.tsx`），
  该清单是 `frontend/app/view/aisessions/sources.tsx` 里写死的常量。
- `chatSourcesForAvailability()` 的动态合并救不了新 provider：它只覆盖 chat-composer / session-detail，
  且数据来自 `/api/aisessions-chat` 的 `AvailableProviders()`（GUI-chat provider 注册表，与扫描 provider 是两回事）。

**新增 provider 必须同步四处，缺一不可：**

1. `frontend/app/view/aisessions/sources.tsx`：`CHAT_SOURCES` 加条目（id / label / `dotClass: "bg-source-<id>"`）。
2. `frontend/tailwindsetup.css`：加 `--color-source-<id>` 色变量（与 `agent-logo.tsx` 中该品牌 iconColor 一致）。
3. `frontend/app/view/aisessions/types.ts`：`SourceFilter` 加字面量；`filter-presets.ts` 的 `SourceValues` 同步。
4. `frontend/app/view/term/agent-logo.tsx`：`getAgentLogoByProvider` 加图标分支（有则自动进筛选栏图标）。

回归测试：`sources.test.tsx` 的 `CHAT_SOURCES` id 清单断言。

## 改动检查清单

- [ ] 新增扫描路径是否走 `ScanAllSummaries`？有没有直接调 `ScanSummaries`？
- [ ] 是否有可能在同一 scanKey 上并行起两个全量扫描？
- [ ] 预算耗尽时是否会误写 `HasSummaryScan` 完成标记？
- [ ] 详情路径（Load/Delta）是否仍拿到当前 mtime/size？
- [ ] `go test ./pkg/aisessions/...` 是否包含 singleflight / 预算 / stale 快返回 / mtime 倒序用例？
- [ ] 前端动到 `aisessions.tsx` 时，`vitest run frontend/app/view/aisessions` 是否全绿？

## 消息模型解析契约（2026-11-09，`11-09-aisessions-pi-codex-model-parse`）

`Message.Model` 是 Agent 卡片副标题与 AI Audit 的唯一模型来源。`LiveSessionState`
的磁盘兜底（`pkg/service/aisessionsservice/chatcontrol.go`）倒序取 `detail.Messages`
里最后一个**非空** `Model`，所以 provider 不填 = 卡片恒显示「未指定」。

各 provider 的模型来源**形状不同**，新增/修改解析时必须按各自形状取：

| provider | 模型所在位置 | 解析方式 |
| --- | --- | --- |
| claude | 每条 assistant `message.model` | 单行直取 |
| opencode | message `modelID` + `providerID` | 单行直取 |
| pi | assistant `message.model`；会话头/切换 `model_change.modelId` | 单行直取 + `model_change` 兜底 |
| codex | **不在消息上**，在每轮 `turn_context.payload.model` | 需跨行状态（`codexMessageParser`） |

**踩过的坑**：2026-11-04 的 `11-04-fix-agent-card-model-vendor` 判定「codex/pi transcripts
不暴露 Model」，实际是这两个 provider 的解析函数从没读过该字段。**判断某个 provider
能不能取到模型，必须打开真实会话文件验证，不能从解析代码里有没有 `Model` 反推。**

已知取舍：`LoadMessageDelta` 与远端 delta 走无状态单行解析器，拿不到 codex 的
`turn_context` 状态，尾部增量消息可能缺 Model；首次全量 `Load` 已带，卡片走全量。

守卫测试：`TestPiAssistantMessageModel` / `TestPiModelChangeFallback` /
`TestCodexTurnContextModel`（`pkg/aisessions`）。
