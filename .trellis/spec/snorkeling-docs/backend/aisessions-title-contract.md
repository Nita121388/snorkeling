# AI 会话标题语义契约

> 会话标题的**唯一来源与优先级**、`titleSource` 语义、以及后台 AI 标题自动生成的边界。
> 实现：`pkg/aisessions/{metastore,sqlite_index,manager,titleautogen,titlegenerate}.go`。

---

## 1. 标题优先级（唯一真相）

```
user  >  ai  >  first_user_message  >  source_title  >  project  >  id
```

| titleSource | 含义 | 谁能写 |
|---|---|---|
| `user` | 用户手动改名 / InfoCard 手动 Apply | `Manager.SetTitle` → `sqlite-title` / meta `SetTitle` |
| `ai` | 后台 AI 自动生成 | `Manager.setAutoTitle` → `sqlite-ai-title` / meta `SetAutoTitle` |
| `first_user_message` | solid 首条用户消息截断（provider 扫描） | provider（`provider_*.go`） |
| `source_title` | 会话文件自带真实标题（opencode/pi session name、codex index） | provider |
| `project` | 项目文件夹 basename | provider 兜底 |
| `id` | 会话 id | provider 兜底 |

**不变量：`user` 永不被任何自动通道覆盖。** `ai` 覆盖 `first_user_message`/`project`/`id`，但被 `user` 覆盖。
`source_title` **不参与**自动生成（比首条消息更权威）。

## 2. 存储

- SQLite `ai_session_meta` 三列：`title_source`（默认 `'user'`）、`ai_title_attempted_at`、
  `ai_title_attempt_message_count`。旧库由 `ensureMetaAutoTitleColumns` ALTER 补齐。
- JSON meta 同名列（`titleSource` / `aiTitleAttemptedAt` / `aiTitleAttemptMessageCount`）。
- **读回**：`ApplyMeta` / `applyBatchMeta` 在 `title != ""` 时用 `title_source`；空串按 `'user'`
  处理（兼容历史行，历史行全部是用户手改或 AI Apply）。

## 3. `setMetaTx` 合并规则（必须保持）

**以 existing 行为基底，只覆盖本 source 负责的字段**：

```
sqlite-mark            → 只改 marked
sqlite-note(-tags)     → 只改 note
sqlite-title           → title + title_source='user'
sqlite-ai-title        → title + title_source='ai'
sqlite-ai-title-attempt→ 只改两个 ai_title_attempt_* 列
default                → 整体替换
```

回归点：写 note 不能清 title/title_source；写 ai-title 不能动 note/tags/marked；
写 attempt 不能动任何其他列。由 `TestSetMetaTxPreservesUnrelatedFields` 锁定。

## 4. 后台 AI 标题自动生成（`titleautogen.go`）

- **开关**：`settings.json` 的 `ai:sessionautotitle`（默认 **关**，nil 视为 false）。
  间隔 `ai:sessionautotitleintervalms`（默认 1500），批量 `ai:sessionautotitlebatchsize`（默认 20）。
  另外仍受 `aiprompts.json` 的 `session-title.enabled` 约束，两者都开才生成。
- **入队**：`Manager.ScanListResult` 的两个返回点调用 `enqueueAutoTitles`。**只做 O(1) map 插入
  + 非阻塞 poke，绝不调用 AI、绝不阻塞。**
- **worker**：每 index path 一个（`autoTitleWorkers`，仿 `scanFlights`），串行、间隔限流、
  单批上限。`pkg/aisessions` 通过 `ManagerOptions.OnTitleUpdated` 回调把结果交给
  `pkg/service/aisessionsservice` 发布 `aisessions:titleupdated` wps 事件（本包不 import wps）。
- **幂等**：`autoTitleEligible` 只放行 `titleSource ∈ {"",first_user_message, project, id}`
  且 `AITitleAttemptedAt == 0` 且 `!Missing`。每次尝试（成败）都 `MarkAITitleAttempt` →
  同一会话**最多自动生成一次**，重启/重扫不重复。策略：会话变长也**不**自动重生成。
- **失败静默**：生成失败/空返回不写标题、只记 attempt、不弹错。

## 5. Tab 标题显示（前端）

`frontend/app/block/block.tsx` `InlineTabLabel.defaultTitle` 对会话类 block
（`isSessionDetailBlockMeta || isChatBlockMeta`）分层：

1. 会话标题（`useBlockSessionTitle`，仅 active/hover tab 触发 `ensureSessionNote`）；
2. `basename(cmd:cwd)`（+ ` · connection`）；
3. `frame:title` 兜底（`"Session Details"` / `"New Session"`）。

建块时必须把 `projectPath` 写进 `cmd:cwd`（`openAISessionDetailFromList` 的 `options.cwd`），
否则唯一可用的兜底信息就丢失了。

## 6. 检查清单

- [ ] 改任何 meta 写入路径后，跑 `go test ./pkg/aisessions/`。
- [ ] 新增 titleSource 值时，同步更新 `autoTitleEligible` 与 `setMetaTx` 合并规则。
- [ ] 关闭 `ai:sessionautotitle` 时不得产生任何 `GenerateSessionTitle` 调用。

## 7. 手动触发的后台生成（AutoGenerate，2026-10-25）

在 §4 的自动巡检之外，新增**用户显式触发**的同类 job，二者共用同一个 per-index 串行 worker
（`pkg/aisessions/titleautogen.go` 的 `autoTitleQueue`）：

- **RPC**：`AISessionsService.AutoGenerate({ ids, connection, kind, force, aiMode })`
  → 立即返回 `{ queued, skipped, errors }`，请求路径零 AI 调用。
  - `kind`：`title` / `metadata` / `both`（`normalizeGenKind` 白名单）。
  - 批量上限 `MaxAutoGenerateBatch = 50`，超出整单拒绝（不部分执行）。
  - skip 原因：`missing` / `no-messages` / `user-title`。
- **job 语义**：`genJob{kind, manual, force, attempt, connection, aiMode}`；
  pending 去重键是 `key|kind`（同一会话的 title 与 metadata 可并存）。
- **入口**：`Manager.EnqueueManualGeneration(reqs)`（O(1) 入队）。
- **开关**：手动 job **不受** `ai:sessionautotitle` 约束；该开关只 gates 自动巡检入队。
- **重试**：`manual=true` 失败按 `manualRetryBackoff` = 2s / 5s / 15s 退避，
  `ManualGenerationMaxAttempts = 3`（首次 + 2 次重试）。配置类错误
  （`user-title` / feature disabled / missing）**不重试**。
  自动巡检 job 行为不变：失败写 `ai_title_attempted_at`、不重试。
- **force**：`titleSource == "user"` 时默认 skip（`user-title`）；`force=true` 才覆盖。
- **metadata 落库**：`GenerateSessionMetadata` → `Manager.NoteAndTags`（不新增表/列，
  不影响 `titleSource`）。
- **状态事件**：每次迁移发布 `aisessions:generationstatus`
  `{key, kind, connection, state(queued|running|done|failed), attempt, maxAttempts, error, updatedAt}`
  （`pkg/wps/wpstypes.go`：`Event_AISessionsGenerationStatus`）；
  成功仍发 `aisessions:titleupdated`（metadata 场景 summary 带 note/tags，前端按字段 merge）。
- **前端**：`aisession-gen-store.ts` 合并状态驱动按钮三态；
  列表/详情/Tab 对 `titleSource === "ai"` 显示小魔杖图标；
  note 静默覆盖提供 10s Undo（`undo-toast.tsx`，以 `updatedAt` 语义做撤销基线）。

新增检查项：

- [ ] 改 worker 时确认自动 job 仍"至多一次"（`titleautogen_test.go` 既有断言不得改）。
- [ ] `AutoGenerate` 请求路径不得出现 `GenerateSessionTitle` / `GenerateSessionMetadata` 调用。
- [ ] 新状态事件必须带 `connection`，前端 store key 含 connection。
