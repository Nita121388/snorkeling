# 技术设计：实时运行会话总览

## 1. 边界

- 新增 `pkg/agentcontrol`（本任务只放 `types.go` / `session.go` / `redact.go` / `errors.go`）。
- `wshserver` 实现 3 个只读 RPC，直接调用 `agentstatus` / `chat.Manager` / `aisessions.Manager` / `wstore`。
- 不改 `pkg/service/*`，不新增前端文件，不改 `frontend/*`。

## 2. 数据流

```
wshsession live
  └─ SessionLiveCommand (wsh RPC, control route)
       ├─ wstore: 所有 block（含 meta.agent:provider / agent:sessionid / connection）
       ├─ blockcontroller.GetBlockControllerRuntimeStatus(blockId)     // running? 
       ├─ agentstatus.Get(blockId)                                    // 内存态，无 IO
       ├─ chat.Manager.ActiveSessions()                               // 新增枚举
       ├─ chat.Session.GetState(ctx)                                  // 并发 ≤4, 1.5s timeout
       ├─ aisessions.Manager: ListCached/ScanListResult + Summary     // 有预算、可 stale
       └─ merge + 排序 + 脱敏 → LiveSessionRecord[]
```

**关键约束（来自 scan contract）：** 不得直接调用 `ScanSummaries`；批量摘要优先用 sqlite 索引/缓存，
缺失项再逐个 `Summary`（其 `allowStale=true`）。`session live` 不得因为 N 个 block 触发 N 次全量扫描。

## 3. 关键类型

```go
// pkg/agentcontrol/types.go
type LiveSessionRequest struct {
    IncludeIdle bool     `json:"includeIdle,omitempty"`
    BlockIds    []string `json:"blockIds,omitempty"`   // 可选：只查目标块
    MaxRows     int      `json:"maxRows,omitempty"`    // 默认 200
}

type LiveSessionRecord struct {
    BlockId    string                `json:"blockId"`
    TabId      string                `json:"tabId,omitempty"`
    WindowId   string                `json:"windowId,omitempty"`
    View       string                `json:"view"`
    Conn       string                `json:"conn,omitempty"`
    Provider   string                `json:"provider,omitempty"`
    SessionId  string                `json:"sessionId,omitempty"`
    SessionKey string                `json:"sessionKey,omitempty"`
    Title      string                `json:"title,omitempty"`
    TitleSource string               `json:"titleSource,omitempty"`
    ProjectPath string               `json:"projectPath,omitempty"`
    Issue      *LiveIssue            `json:"issue"`    // nil = 无 agentstatus
    Chat       *LiveChat             `json:"chat"`     // nil = 非 GUI chat
    Card       *LiveCard             `json:"card"`     // nil = 摘要不可用
    Warnings   []string              `json:"warnings,omitempty"`
}

type LiveIssue struct {
    State, PrevState, Phase, ToolName, Message, Reason, Source, Confidence string
    ActiveSince, UpdatedAt, ExpiresAt, Seq int64
    Freshness string `json:"freshness"` // fresh | stale
}

type LiveChat struct {
    State string; IsStreaming bool
    ModelProvider, ModelId, ThinkingLevel string
    ContextUsagePct *float64; MessageCount int; LastUsedAt int64
    Provisional bool
}

type LiveCard struct {
    Note string; Tags []string; Props map[string]aisessions.PropertyCell; Hash string
}
```

## 4. 合并算法（顺序敏感）

1. **候选块集合**：`view=="agent"` OR `meta["agent:provider"]!=""` OR `meta["agent:sessionid"]!=""`
   OR `agentstatus.Get(blockId)!=nil` OR `blockcontroller` 状态为 running 且 meta 有 provider。
2. 对每个候选块构造 record：meta → `Issue`（若有）→ `Chat`（若 chatManager 有匹配 source/sessionId）→ `Card`（摘要）。
3. `chatManager` 里存在、但没有对应 block 的会话（例如 block 已关但子进程未回收）**也要出行**，
   `blockId=""`、`warnings:["orphan-chat"]`。否则 Agent 会以为没有在跑。
4. 去重键：`SessionKey`（非空时）否则 `blockId`。同一 session 多块（resume/tab）保留 `blockId` 最新的一行，
   其余并入 `warnings` 或直接在 `BlockIds` 附加（v1 简化为取 `UpdatedAt` 最大者）。
5. 过滤：默认丢弃 `Issue.State=="idle" && !Chat.IsStreaming && !Chat.Live`；`--include-idle` 全留。
6. 排序：`Issue.State` 权重（working/blocked > idle > stale）→ `ActiveSince` 倒序 → `BlockId`。

## 5. `chat.Manager.ActiveSessions()`

```go
type LiveChatInfo struct {
    Source, SessionID string
    State             SessionState
    LastUsed          time.Time
    Provisional       bool
}

func (m *Manager) ActiveSessions() []LiveChatInfo
```

- 遍历 `m.sessions`，跳过 `StateClosed`；`SessionID` 从 key（`source/sessionID`）推导。
- `Provisional`：key 的第二段以 `new:` 开头（`Ensure` 尚未 Promote）。
- 不调用 `GetState`（RPC 往返），由调用方按需并发拉取。
- 排序稳定，便于测试。

## 6. `this` 解析

优先级：block meta `agent:sessionid` → `agentstatus.Get(blockId).SessionId` → `liveregistry` 按 block 无法命中则失败。
外部 token 无 `WAVETERM_BLOCKID` 时（P1.5 才接）由 `--block` 显式给出；本任务先不做外部 token。

## 7. 并发与预算

- `GetState` 并发 4，单次 1.5s；失败仅丢弃 `chat.model/thinking/contextUsage/messageCount/isStreaming`，保留 `state/lastUsed`。
- `Summary` 并发 4，单次 2s；失败置 `Card=null` + warning。
- 整体 RPC 超时 8s；超时返回已完成的部分 + `partial:true`（不报错）。

## 8. 脱敏

- `meta` 不整体输出；只输出白名单字段（§7.6/§7.1）。
- `reason`/`message` 可能含 URL 或密钥 → 复用 `agentcontrol/redact.go`（正则替换 token/key/sig）。
- `FilePath` 不输出。

## 9. 测试

- 单测：合并算法（表驱动：无 issue / 仅 chat / orphan chat / 远程降级 / 过期 / 去重 / 过滤）。
- 单测：`ActiveSessions()` 排序与 Provisional。
- golden：`session live --json` 输出结构。
- 并发：N 个 block 时 `Summary` 调用次数 ≤ N 且不触发 `ScanSummaries`（用 fake manager 计数）。
