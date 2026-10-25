# Design: AutoGenerate RPC 与后台 worker 通用化

## 1. 数据结构（`pkg/aisessions/titleautogen.go`）

```go
type genKind string

const (
    GenKindTitle    genKind = "title"
    GenKindMetadata genKind = "metadata"
    GenKindBoth     genKind = "both"
)

type genJob struct {
    key, source, projectPath string
    messageCount int
    kind      genKind
    manual    bool
    force     bool
    attempt   int
    aiMode    string
}

type autoTitleQueue struct {
    mu       sync.Mutex
    pending  map[string]genJob // key = job.key + "|" + string(job.kind)
    order    []string
    wake     chan struct{}
    // 既有字段...
    publish       func(SessionSummary)
    publishStatus func(GenerationStatusEvent)
}
```

**为何 pending 用 `key|kind`**：同一会话可能同时被用户点 title 和 metadata；
用纯 key 会让后者覆盖前者。

## 2. 重试

```go
const (
    manualMaxAttempts = 3
    // attempt 0 失败后：2s，attempt 1 失败后：5s，attempt 2 失败后：15s
    manualRetryBackoff = []time.Duration{2 * time.Second, 5 * time.Second, 15 * time.Second}
)
```

`runOne` 失败路径：

```go
func (q *autoTitleQueue) onFailure(job genJob, err error) {
    if !job.manual {
        // 自动 job：保持既有至多一次语义
        if job.kind != GenKindMetadata {
            _ = q.newManager().markAITitleAttempt(context.Background(), job.key, job.messageCount)
        }
        q.status(job, "failed", err)
        return
    }
    q.status(job, "failed", err) // 每次失败都发，attempt 递增
    if job.attempt+1 >= manualMaxAttempts {
        return // 终态，不再入队
    }
    delay := manualRetryBackoff[job.attempt]
    job.attempt++
    time.AfterFunc(delay, func() {
        q.push(job) // push 内部会 poke wake
    })
}
```

> `time.AfterFunc` 回调里只调 `push`（O(1) 加锁），不直接 `runOne`，避免并发执行。

## 3. 状态事件

```go
type GenerationStatusEvent struct {
    Key         string `json:"key"`
    Kind        string `json:"kind"`
    Connection  string `json:"connection,omitempty"`
    State       string `json:"state"` // queued|running|done|failed
    Attempt     int    `json:"attempt"`
    MaxAttempts int    `json:"maxAttempts"`
    Error       string `json:"error,omitempty"`
}
```

`ManagerOptions` 增 `OnGenerationStatus func(GenerationStatusEvent)`；`NewManagerWithOptions` 透传；
`autoTitleWorker()` 构造 `autoTitleQueue` 时复制该回调。

`pkg/wps/wpstypes.go`：

```go
Event_AISessionsGenerationStatus = "aisessions:generationstatus" // type: aisessions.GenerationStatusEvent
```
并加入 `AllEvents`。

## 4. metadata 分支

```go
func (q *autoTitleQueue) runMetadata(m *Manager, summary SessionSummary, job genJob) (SessionSummary, error) {
    promptCfg := promptConfigForFeature(PromptFeatureSessionNoteTags) // 已存在（service 层）；需下沉到 aisessions 包
    if !PromptEnabled(promptCfg) { return summary, errFeatureDisabled }
    detail, err := m.Load(ctx, summary.Key, LoadOptions{})
    if err != nil { return summary, err }
    sugg, err := GenerateSessionMetadata(ctx, MetadataGenerateRequest{
        SessionKey: detail.Summary.Key, Source: detail.Summary.Source,
        ProjectPath: detail.Summary.ProjectPath, Messages: detail.Messages,
        ExistingNote: detail.Summary.Note, ExistingTags: detail.Summary.Tags,
        AIMode: job.aiMode, PromptConfig: promptCfg,
    })
    if err != nil { return summary, err }
    return m.NoteAndTags(ctx, summary.Key, strings.TrimSpace(sugg.Note), sugg.Tags)
}
```

> `promptConfigForFeature` 目前是 service 包私有函数；在 `aisessions` 包内提供一个等价
> `PromptConfigForFeature(feature string) wconfig.AIPromptConfigType`，service 层改为调用它（去重）。

## 5. RPC

`pkg/service/aisessionsservice`：

```go
type AISessionsAutoGenerateRequest struct {
    Ids        []string `json:"ids"`
    Connection string   `json:"connection,omitempty"`
    Kind       string   `json:"kind"`  // title|metadata|both
    Force      bool     `json:"force,omitempty"`
    AIMode     string   `json:"aiMode,omitempty"`
}
type AutoGenSkipReason struct { Id, Reason string }
type AISessionsAutoGenerateResponse struct {
    Queued  []string            `json:"queued"`
    Skipped []AutoGenSkipReason `json:"skipped"`
    Errors  []string            `json:"errors,omitempty"`
}
```

实现步骤：

1. `kind` 白名单校验；非法 → error。
2. `len(Ids) > MaxAutoGenerateBatch(50)` → error。
3. `managerForRequest(ctx, ids[0], connection)`（远端路由；同一请求假定单连接）。
4. 对每个 id：
   - `summary, err := manager.Summary(ctx, id)`（已有轻量读）→ err 收进 `Errors`。
   - `missing` → skip `missing`；`messageCount==0` → skip `no-messages`；
     `kind in {title,both} && titleSource=="user" && !force` → skip `user-title`。
5. `manager.enqueueManualGen(jobs)` → 返回。

`enqueueManualGen`（`titleautogen.go`）：

```go
func (m *Manager) enqueueManualGen(jobs []genJob) {
    if len(jobs) == 0 { return }
    q := m.autoTitleWorker()
    for _, job := range jobs {
        q.push(job)
        q.status(job, "queued", nil) // 需要 job 上有 connection 字段或由 publisher 闭包注入
    }
}
```

> **connection 注入方式**：`genJob` 增加 `connection string`；`AutoGenerate` 填；
> `status()` 里透传给 `publishStatus`。worker 侧 publisher 不再靠闭包注入 connection。

## 6. 并发与安全

- worker 是 per-index 单例；`AutoGenerate` 来自多个 RPC 走同一队列，天然串行。
- `push` 去重：`pending[key|kind]` 已存在则不覆盖（保留先到的 job），避免重复烧额度。
- 手动 job **不受** `autoTitleEnabled()` 限制：`run()` 里的 `if !autoTitleEnabled() { break }`
  需改成「仅对 `!job.manual` 生效」，或 `run()` 不检查开关、由 `enqueueAutoTitles` 决定是否入队。
  **推荐后者**（开关只 gates 自动入队，worker 执行不再看开关）。

## 7. 测试

- `titleautogen_test.go` 扩：
  - `manual` 失败 3 次的状态序列（attempt 0→1→2→3，终态 failed）。
  - `force=false` 跳过 user 标题；`force=true` 覆盖。
  - `kind=metadata` 只动 note/tags；`kind=both` 两步都做。
  - pending 去重 `key|kind`。
- `aisessionsservice_test.go`（若无则新建）：批量上限、skip 原因、kind 校验。
- 既有 `autoTitleEligible` / attempt 幂等测试不改。

## 8. 回滚

新增字段/事件/RPC 均为增量；若不发布前端，后端 worker 的 manual 分支永远不会被调用。
