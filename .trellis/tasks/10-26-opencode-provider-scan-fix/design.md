# 技术设计：OpenCode Provider 扫不到会话（schema 漂移修复）

## 1. 现状（代码坐标）

### 后端

| 位置 | 现状 | 问题 |
|---|---|---|
| `pkg/aisessions/paths.go:102 userCacheDir` | `os.UserCacheDir()` | Windows 上是 `%LOCALAPPDATA%` |
| `pkg/aisessions/paths.go:109 DefaultOpenCodeDBPath` | `OPENCODE_DB` → `<cache>/opencode/opencode.db` | 漏 `~/.local/share/opencode/opencode.db`；本机真实路径不命中 |
| `pkg/aisessions/paths.go:131-138` 注册 | `os.Stat(dbPath)` 存在才注册 | 路径错→不注册→无数据 |
| `provider_opencode.go:100 List` | `SELECT id,title,directory,time_created,time_updated,model_provider,model_id FROM session` | `model_provider/model_id` 列不存在 |
| `provider_opencode.go:214/310/331` | `SELECT role,content,time_created FROM session_message/message` | `role/content` 列不存在；`session_message` 0 行 |
| `provider_opencode.go:428/446` | `SELECT role,content FROM session_message/message WHERE role='assistant'` | 同上，且 `role` 列不存在 |
| `provider_opencode.go:257 rowToSummary` | 只填 `VendorID=model_provider` | 无 `Model`、无 `ParentKey`、无 `Kind` |

### 前端

| 位置 | 现状 |
|---|---|
| `frontend/app/view/aisessions/types.ts:4 SourceFilter` | 已含 `"opencode"` |
| `frontend/app/view/aisessions/sources.tsx:45` | source 选项动态来自 `body.sources`，**无硬编码排除** |
| `frontend/app/view/aisessions/utils.ts:430` | opencode resume 命令已实现 |

> 结论：前端已就绪。**根因全在后端**——路径探测 + schema 解析。

## 2. 真实 schema（实测，只读打开本机 db）

```
session(id, project_id, workspace_id, parent_id, slug, directory, path, title, version,
        share_url, summary_additions, summary_deletions, summary_files, summary_diffs,
        metadata, cost, tokens_*, revert, permission, agent, model, time_created,
        time_updated, time_compacting, time_archived)
  · model = JSON {"id":"space-bunny-free","providerID":"opencode-go","variant":"max"}
  · parent_id 有值 ⇒ 子会话
  · directory = 项目路径（如 D:/Code/LiCASmart）

message(id, session_id, time_created, time_updated, data)          -- 1003 行
  · data = JSON {"role":"user","time":{...},"agent":"build","model":{...},"summary":{...}}

part(id, message_id, session_id, time_created, time_updated, data) -- 4158 行
  · data.type ∈ {text, patch, reasoning, tool, step-start, step-finish, compaction}
  · data.text 承载正文；data.* 承载工具名/参数

session_message(id, session_id, type, seq, time_created, time_updated, data) -- 本机 0 行
```

## 3. 设计

### 3.1 DB 路径探测（paths.go）

```go
// openCodeDBCandidates 返回候选 db 路径（按优先级）。
func openCodeDBCandidates() []string {
    var out []string
    if env := os.Getenv("OPENCODE_DB"); env != "" {
        out = append(out, env)
    }
    // XDG data home
    if x := os.Getenv("XDG_DATA_HOME"); x != "" {
        out = append(out, filepath.Join(x, "opencode", "opencode.db"))
    }
    if home, err := os.UserHomeDir(); err == nil {
        out = append(out, filepath.Join(home, ".local", "share", "opencode", "opencode.db"))
    }
    // 旧 cache 假设（兼容）
    if c := userCacheDir(); c != "" {
        out = append(out, filepath.Join(c, "opencode", "opencode.db"))
    }
    return out
}

func DefaultOpenCodeDBPath() string {
    for _, p := range openCodeDBCandidates() {
        if info, err := os.Stat(p); err == nil && !info.IsDir() {
            return p
        }
    }
    return ""
}
```

> 注意：`DefaultOpenCodeDBPath` 当前不做 stat，由 `DefaultProviders` 做。改为在这里直接
> 返回第一个存在路径，`DefaultProviders` 的 gating 可保留（幂等）。

### 3.2 session 解析（provider_opencode.go）

```go
const openCodeSessionSelect = `
SELECT id, title, directory, path, parent_id, agent, model, time_created, time_updated
FROM session`

func (p *OpenCodeProvider) rowToSummary(id, title, directory, path, parentID, agent, modelJSON string, timeCreated, timeUpdated int64) SessionSummary {
    title = normalizeTitle(title)
    ...
    modelID, providerID := parseOpenCodeModel(modelJSON) // {"id","providerID"}
    summary := SessionSummary{
        ID: id, Source: SourceOpenCode, Title: title,
        ProjectPath: directory, CreatedAt: timeCreated, UpdatedAt: timeUpdated,
        FilePath: p.sessionFilePath(id),
        VendorID: providerID, Model: modelID,
    }
    if parentID != "" && parentID != id {
        summary.Kind = SessionKindSubagent
        summary.ParentKey = StableKey(SourceOpenCode, parentID, p.sessionFilePath(parentID))
    } else {
        summary.Kind = SessionKindSession
    }
    summary.Key = StableKey(summary.Source, summary.ID, summary.FilePath)
    return summary
}

func parseOpenCodeModel(raw string) (modelID, providerID string) {
    if strings.TrimSpace(raw) == "" { return "","" }
    var v struct{ ID, ProviderID string `json:"providerID"` }
    v.ID = ""
    // 用 map 解析，容错字段名
    var m map[string]any
    if json.Unmarshal([]byte(raw), &m) != nil { return raw, "" }
    if s, ok := m["id"].(string); ok { modelID = s }
    if s, ok := m["providerID"].(string); ok { providerID = s }
    return
}
```

> `SessionSummary.Model` 已存在（types.go:71）。

### 3.3 消息读取（message + part）

```go
// LoadMessages: 先拉该 session 的所有 message，再按 message_id 分组拉 part。
func (p *OpenCodeProvider) loadMessagesNew(ctx, db, sessionID) ([]Message, error) {
    // 1) message 行
    rows := query(`SELECT id, time_created, data FROM message WHERE session_id=? ORDER BY time_created, id`, sessionID)
    // 2) 每条 message 的 parts
    //    parts: SELECT message_id, data FROM part WHERE session_id=? ORDER BY message_id, time_created, id
    //    按 message_id 归并
    // 3) 拼装 Message{Seq, Role, Text, Timestamp}
    //    role 从 message.data.role
    //    text = concat(part.data.text where type == "text")
    //    若多个 text part，用 "\n\n" 连接
}
```

**part 聚合规则**：
- `type == "text"` → `data.text` 拼入正文。
- `type == "tool"` → 记入 ToolCall（name = `data.tool` 或 `data.name`，摘要 = 参数）。
- `type ∈ {reasoning, patch, step-start, step-finish, compaction}` → 默认不拼入正文（可选
  在 Message 上加轻量标注，本次先忽略，避免污染正文）。

**顺序**：`message` 按 `time_created, id`；`part` 按 `time_created, id` 稳定排序（无 seq 列）。

**V1 回退**：所有新查询失败且错误是 `no such table/column` 时，回退到旧的
`session_message`（若存在）或 `message(content 列)` 形态。本机实测新形态生效，回退仅防御。

### 3.4 LoadToolCalls

复用 3.3 的 part 数据，挑 `data.type == "tool"`：
```go
ToolCall{Seq, Name: toolName, Summary: summarizeToolInput(data["input"]/data["args"])}
```

### 3.5 LoadMessageDelta

```go
func (p *OpenCodeProvider) LoadMessageDelta(ctx, filePath string, cursor SessionMessageCursor, maxBytes int64) (MessageDelta, error) {
    // 解析 sessionID；按 cursor.MTime（time_created 毫秒）之后的新 message 取增量；
    // cursor.FileSize 复用为该 session 的 message 行计数（或最大 time_created）。
    // 返回 MessageDelta{Cursor, Messages, Summary}
}
```
> 与 codex/claude/pi 的 delta 语义对齐：cursor 记录"已读到的消息游标"。opencode 无文件
> 字节流，用 `time_created` + 消息 count 作游标最稳。`ResetRequired` 在检测到计数回退时置真。

### 3.6 数据流

```
DefaultProviders
  └─ DefaultOpenCodeDBPath → 命中 ~/.local/share/opencode/opencode.db → NewOpenCodeProvider(dbPath)
       └─ List: SELECT 真实列 → rowToSummary(model JSON, parent_id) → SessionSummary{Model,VendorID,Kind,ParentKey}
            └─ 前端 sources.tsx 动态出现 opencode → 列表渲染
       └─ LoadMessages: message + part → Message[]（text 聚合）
       └─ LoadToolCalls: part.type=tool
       └─ LoadMessageDelta: time_created 游标增量
```

## 4. 契约变化

| 层 | 变化 | 兼容 |
|---|---|---|
| `SessionSummary` | opencode 行填 `Model` / `Kind` / `ParentKey` | 纯新增，旧前端忽略 |
| SQLite schema | 无（只读 OpenCode db，不改其结构） | — |
| `Provider` 接口 | opencode 新增实现 `MessageDeltaProvider` | 增量能力变强 |
| RPC `sources` | 可能出现 `opencode` | 前端已支持 |

## 5. 测试设计（fixture，不依赖本机 db）

`provider_opencode_test.go` 用 `modernc.org/sqlite` 在临时文件建库，灌入新 schema：
```sql
CREATE TABLE session(id TEXT PRIMARY KEY, title TEXT, directory TEXT, path TEXT, parent_id TEXT,
                     agent TEXT, model TEXT, time_created INTEGER, time_updated INTEGER);
CREATE TABLE message(id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
CREATE TABLE part(id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
```
用例：
1. `TestOpenCodePathCandidates` — 候选顺序、`OPENCODE_DB` 优先、命中第一个存在。
2. `TestListParsesModelJSON` — `model` JSON → `Model`/`VendorID` 正确。
3. `TestListParentIdSubagent` — `parent_id` 非空 → `Kind=subagent`、`ParentKey` 非空。
4. `TestLoadMessagesAggregatesTextParts` — 多 text part 拼正文，role 正确。
5. `TestLoadMessagesSkipsNonTextParts` — reasoning/patch/step-* 不进正文。
6. `TestLoadToolCallsFromParts` — `type=tool` 提取 name/摘要。
7. `TestLoadMessageDeltaIncremental` — 增量只返回新消息，游标前进。
8. `TestLoadSnippet` — 取最后一条有文本消息。

## 6. 取过的方案与放弃理由

| 方案 | 放弃原因 |
|---|---|
| 只改路径不改 schema | schema 列名全变，改了路径照样 `no such column` |
| 继续读 `session_message` 的 `role/content` | 真实该表 0 行且无这两列 |
| 把 part 全塞进正文 | reasoning/patch 会污染对话，体验差 |
| 用 `session_message.seq` 做游标 | 该表本机空，新 schema 消息在 message 表且无 seq |
| 前端加 opencode 硬编码分支 | 前端已是动态来源，后端修好自动出现，无需动 |

## 7. 回滚

- 改动集中在 `paths.go`（路径探测）+ `provider_opencode.go`（解析）。任一处 revert 即
  回到"opencode 不显示"的旧状态，不影响其他 provider。
- 无 DB migration，无数据回滚需求。
