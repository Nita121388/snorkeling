# Design: AI 会话标题 —— Tab 分层显示 + 后台异步 AI 标题生成

## 1. 边界与总览

```
┌─ 后端 pkg/aisessions ────────────────────────────────────────────┐
│  titleSource 语义扩展 (user > ai > first_user_message > ...)      │
│  ├─ metastore.go    : sessionMeta + TitleSource/AI 尝试字段       │
│  ├─ sqlite_index.go : ai_session_meta 新增 3 列 + setMetaTx 合并化 │
│  ├─ manager.go      : SetAutoTitle / MarkAITitleAttempt / 优先级    │
│  └─ titleautogen.go : 后台队列 worker（串行限流、幂等、可开关）     │
│  List 漏斗 (ScanListResult) → enqueue（仅写 map，非阻塞）          │
└──────────────────────────────────────────────────────────────────┘
                 │ attempt/生成完成 → 广播 AiSessionNoteUpdated
                 ▼
┌─ 前端 ───────────────────────────────────────────────────────────┐
│  session-detail-block.ts : 建块补 cmd:cwd，frame:title 降级兜底    │
│  block.tsx InlineTabLabel: 会话类 block 走分层标题分支              │
│  waveconfig/aipromptsettings: 新增「自动生成标题」开关 + 间隔       │
└──────────────────────────────────────────────────────────────────┘
```

## 2. titleSource 优先级（唯一真相）

```
user  >  ai  >  first_user_message  >  source_title  >  project  >  id
```

- `user`：手动双击改名、InfoCard Apply。**最高，任何自动通道不得覆盖**。
- `ai`：后台自动生成。**覆盖** `first_user_message`/`project`/`id`，**被** `user` 覆盖。
- `source_title`：provider 自带真实标题（opencode/pi session name、codex index）。**不参与**自动生成（比首条消息更权威）。

实现：**不改各 provider 的生成规则**，只改「写入 + 读回」两层：

- 写：`SetTitle`（user）继续写 `title_source='user'`；新增 `SetAutoTitle` 写 `title_source='ai'`。
- 读：`ApplyMeta`/`applyBatchMeta` 若 `title_source` 非空则用它，**空字符串按 `'user'` 处理**（兼容历史行，历史行全是用户手改/AI Apply 落库的）。

## 3. 存储

### 3.1 SQLite `ai_session_meta`（新列，ALTER 增量）

| 列 | 类型 | 说明 |
|---|---|---|
| `title_source` | `TEXT NOT NULL DEFAULT 'user'` | `user` / `ai` |
| `ai_title_attempted_at` | `INTEGER NOT NULL DEFAULT 0` | 上次尝试时间戳（成功/失败都写） |
| `ai_title_attempt_message_count` | `INTEGER NOT NULL DEFAULT 0` | 尝试时的 messageCount（审计/未来可选重生成） |

新增 `ensureMetaAutoTitleColumns`（仿 `ensureMetaTitleColumn`，pragma_table_info 检查后 ALTER）。
**历史行**：`title=''` 的行 title_source 默认 `'user'` 但 ApplyMeta 只在 title 非空时生效，无副作用。

### 3.2 `setMetaTx` 合并化（关键重构）

现状是「按 source 逐个把不该动的字段塞回去」：

```go
if source == "sqlite-mark" { incoming.Note = existing.Note; incoming.Title = existing.Title }
```

再往这个 switch 里加 3 个字段会变成易漏的 3×N 组合，而且写 note 会误清 title_source。改为
**以 existing 为基底、只覆盖本 source 负责的字段**：

```go
merged := existing
switch source {
case "sqlite-mark":                 merged.Marked = incoming.Marked
case "sqlite-note", "sqlite-note-tags": merged.Note = incoming.Note
case "sqlite-title":                merged.Title, merged.TitleSource = incoming.Title, orIfEmpty(incoming.TitleSource,"user")
case "sqlite-ai-title":             merged.Title, merged.TitleSource = incoming.Title, "ai"
case "sqlite-ai-title-attempt":     merged.AITitleAttemptedAt, merged.AITitleAttemptMessageCount = ...
default:                            merged = incoming
}
if incoming.UpdatedAt != 0 { merged.UpdatedAt = incoming.UpdatedAt }
```
SELECT 需同步读出 3 个新列。这是本设计唯一有回归风险的改动 → 必须有单测覆盖
「写 note 不清 title/title_source」「写 ai-title 不动 note/tags/marked」。

### 3.3 JSON Metastore（dual-write / 降级路径）

`sessionMeta` 增加 `TitleSource`、`AITitleAttemptedAt`、`AITitleAttemptMessageCount` 三个 json 字段；
`Apply` 在 title 非空时用 meta.TitleSource（空则 `user`）。新增 `SetAutoTitle`/`MarkAITitleAttempt`。

## 4. 后台队列 `titleautogen.go`

```go
type autoTitleJob struct { key, source, projectPath string; messageCount int }

type autoTitleQueue struct {
    mu      sync.Mutex
    pending map[string]autoTitleJob   // 去重
    order   []string
    wake    chan struct{}             // cap 1，非阻塞投递
    started bool
}
```

- **启动**：`Manager` 持有一个 lazy `sync.Once` → `startAutoTitleWorker()` 只启一个 goroutine。
  在 `enqueueAutoTitles` 第一次被调用且开关打开时启动。
- **入队（热路径，必须 O(1)）**：`enqueueAutoTitles(summaries)`：
  1. `if !autoTitleEnabled()` return（一次 fullConfig 读取，config 已缓存，开销极小）；
  2. 过滤 eligibility；对每个 key 做 `pending[key]` 去重、append order；
  3. `select { case wake <- struct{}{}: default: }` —— 绝不阻塞。
- **worker**：
  ```
  for range wake {
      for i := 0; i < batchSize; i++ {
          job := pop()
          if job == nil { break }
          ctx, cancel := context.WithTimeout(bg, 90s)
          runOne(ctx, job)         // 重新校验 eligibility（防期间被改 user）
          cancel()
          if more { sleep(interval) }
      }
  }
  ```
- **runOne**：
  1. 重新 `resolveSession` + 读 meta 确认 titleSource 仍 ∈ {first_user_message, project, id} 且 `attempted_at==0`；否则跳过。
  2. `m.Load(ctx, key, LoadOptions{})` 拿 messages。
  3. `promptConfig := promptConfigForFeature(PromptFeatureSessionTitle)`；`if !PromptEnabled(cfg) → skip`。
  4. `GenerateSessionTitle(ctx, req)`。
  5. 成功且非空 → `SetAutoTitle`（title_source=ai）+ 广播；失败/空 → 不写标题。
  6. **无论成败** → `MarkAITitleAttempt(now, messageCount)`。
- **静默**：worker 全部 `debugf`，不产生前端错误。生成完成 → 复用 `AiSessionNoteUpdated` 事件
  （payload 为更新后的 summary），前端 note-cache 已监听并按 key 刷新 → tab/列表自动更新。

### 4.1 Eligibility（纯函数，可单测）

```go
func autoTitleEligible(s SessionSummary) bool {
    return !s.Missing &&
        s.TitleSource != "user" && s.TitleSource != "ai" && s.TitleSource != "source_title" &&
        s.AITitleAttemptedAt == 0 &&
        strings.TrimSpace(s.Key) != ""
}
```

## 5. 配置

`pkg/wconfig/settingsconfig.go` `SettingsType` 新增：

```go
AiSessionAutoTitle            *bool  `json:"ai:sessionautotitle,omitempty"`             // 默认 false
AiSessionAutoTitleIntervalMs  *int64 `json:"ai:sessionautotitleintervalms,omitempty"`   // 默认 1500
AiSessionAutoTitleBatchSize   *int64 `json:"ai:sessionautotitlebatchsize,omitempty"`    // 默认 20
```

Go 侧 `autoTitleEnabled()` 读 `GetWatcher().GetFullConfig().Settings`，指针 nil → 默认关。

前端设置项放在 **AI Prompts 设置页** 的 `session-title` 卡片下（`aipromptsettings.tsx`）：

- checkbox「Auto-generate titles in background（默认关）」
- 说明文案：串行、限流、只对未命名会话生成一次；手动改名永不覆盖
- 写盘走 `RpcApi.SetConfigCommand`（settings.json），与 `commontext-model.ts:418` 同模式

## 6. 前端 tab 标题

### 6.1 建块补 projectPath（第一步，零 RPC）

- `openAISessionDetailFromList` 调用处（`aisessions.tsx:~1572`、`session-detail.tsx` 子代理卡片）
  把 `session.projectPath` 传进 `options.cwd`（字段已存在，只是没传）。
- `makeSessionDetailBlockDef` 已支持 cwd → `cmd:cwd`。
- `newchat` 建块（`openAISessionNewChatFromList`）也接受可选 cwd。

### 6.2 InlineTabLabel 分层（`block.tsx`）

`defaultTitle` 增加**最高优先分支**（在 `frameTitle` 之前）：

```ts
if (isSessionDetailBlockMeta(meta) || isChatBlockMeta(meta)) {
    // 1) 会话标题（user/ai/... 由 summary 决定）— 第二步接入
    // 2) 项目文件夹 basename（+ 远端 · connection）
    // 3) frame:title 兜底（"Session Details"/"New Session"）
}
```

第一步只做 2)/3)：`cmd:cwd` → `basename`。`frame:title` 不再短路会话类 block。

第二步：新增轻量 hook `useBlockSessionTitle(blockId)`：
- 仅当 tab **isActive 或 hover** 时 `ensureSessionNote(service, sessionId, connection)`；
- 用 `useSyncExternalStore(subscribeSessionNote, getSessionNoteSnapshot)` 读 `summary.title`；
- 背景 tab 不订阅、不请求（用 `blockTabTitles` 的 customTitle 与 cwd basename 先撑住）。
- title 到达 → 显示 `summary.title`（通过 cache 广播自动刷新，无需额外轮询）。

- tooltip：`完整 projectPath + (· connection) + session id`。
- 同名去重沿用 `getDuplicateIndexes`（`snorkeling` / `snorkeling 2`）。

## 7. 兼容 / 回滚

- 全部是**增量列 + 增量配置**，旧 DB 自动 ALTER 补齐；关掉开关即完全回到旧行为（零 AI 请求）。
- 回滚：删 `titleautogen.go` 启用点 + 开关默认关即可，数据层新列无害。
- `frame:title` 仍是兜底 → 老的已存在详情块（无 cmd:cwd）显示不变差。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| `setMetaTx` 合并化改坏 note/title 互不覆盖 | 专项单测 + 现有 sqlite_index_test 全跑 |
| 热路径 enqueue 拖慢 List | O(1) map 插入 + 非阻塞 wake；config 读走已缓存 |
| 大量历史会话首次打开开关时集中生成 | batchSize + interval + 游标；单批 20、间隔 1.5s |
| 生成时会话文件 mtime 漂移 | runOne 用 `resolveSessionForMetaWrite`（按 key 直取，跳过 mtime 校验） |
| title 异步到达导致 tab 名跳变 | 可接受；首帧 basename 稳定，title 只做一次覆盖 |
