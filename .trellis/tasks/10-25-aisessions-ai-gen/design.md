# Design: AI 会话标题 / Note / Tags 一键生成

## 1. 总览

```
┌─ 前端入口（agent card / 列表行 / Detail 头栏 / ··· 菜单 / 批量栏） ─────────────┐
│  点击 ──► autoGenerate(kind)                                                    │
│            ├─ resolveMetadataAIMode() 不可用 → 直接给引导（不发 RPC）            │
│            └─ AISessionsService.AutoGenerate({ids, connection, kind, force})    │
│                 → 立即返回 { queued[], skipped[] }                              │
│  状态 ◄── aisession-gen-store 订阅 aisessions:generationstatus                  │
│  结果 ◄── 既有 aisessions:titleupdated / aisession-note-updated                 │
└────────────────────────────────────────────────────────────────────────────────┘
                                    │
┌─ 后端 ─────────────────────────────────────────────────────────────────────────┐
│  AISessionsService.AutoGenerate (新 RPC)                                       │
│    └─ Manager.enqueueManualGen(jobs)  ── O(1)，入 map，poke cap-1 chan          │
│                                                                                │
│  genWorker（复用 titleautogen.go 的进程级 registry，按 index path 单例）        │
│    pop → runOne(kind)                                                          │
│      title    → GenerateSessionTitle → setAutoTitle(source=ai)                 │
│      metadata → GenerateSessionMetadata → SetNoteAndTags                        │
│      both     → 串行执行上面两步                                                │
│    失败 → attempt++ < max ? 退避重新入队 : 终态失败                             │
│    每次迁移 → publish generationstatus                                         │
│    成功   → publish titleupdated / note-updated                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

## 2. 核心契约

### 2.1 job 模型（`pkg/aisessions/titleautogen.go`）

现有 `autoTitleJob` 扩展为：

```go
type genKind string // "title" | "metadata" | "both"

type genJob struct {
    key, source, projectPath string
    messageCount int
    kind      genKind
    manual    bool   // true = 用户显式触发（可重试、不受开关限制）
    force     bool   // 允许覆盖 user 标题 / 非空 note
    attempt   int    // 已尝试次数（0-based）
    aiMode    string // 可选，来自前端 resolveMetadataAIMode()
}
```

**队列结构不变**（`pending map[string]string` → 改为 `map[string]genJob`，按 key 去重；
`order []string`）。同一个 key 的 title 与 metadata 需要共存时，用
`key + "|" + kind` 作为 pending 的去重键。

### 2.2 重试策略

| job 来源 | 失败行为 |
|---|---|
| `manual=false`（列表漏斗自动巡检） | 保持现状：写 `ai_title_attempted_at`，**不重试** |
| `manual=true` | 不写 attempt 终态；`attempt<3` 时退避 `2s/5s/15s` 重新入队；第 3 次失败才报终态 |

> 退避定时器复用 worker 的 `wake` 通道：用一个 `time.AfterFunc` 往 `push` 里塞回 job，
> 不在 run 循环里 `time.Sleep`（避免阻塞其它 key）。

### 2.3 状态事件

新 wps 事件 `aisessions:generationstatus`：

```go
type GenerationStatusEvent struct {
    Key         string `json:"key"`
    Kind        string `json:"kind"`      // title | metadata | both
    Connection  string `json:"connection,omitempty"`
    State       string `json:"state"`     // queued | running | done | failed
    Attempt     int    `json:"attempt"`
    MaxAttempts int    `json:"maxAttempts"`
    Error       string `json:"error,omitempty"`
}
```

发布点：`AutoGenerate` 入队后（queued 每条）、`runOne` 开始（running）、成功（done）、终态失败（failed）。
`Connection` 由 `makeTitleUpdatedPublisher` 同样的闭包注入（worker 是本地 index 单例，
但事件要带来源连接，供远端 GUI 区分）。

**注意**：现有 `OnTitleUpdated` 是 manager 结构体字段；这里新增一个
`OnGenerationStatus func(GenerationStatusEvent)` 并在 `ManagerOptions` 里透传。
`autoTitleQueue` 持有一份 `publishStatus`。

### 2.4 RPC `AutoGenerate`

```go
type AISessionsAutoGenerateRequest struct {
    Ids        []string `json:"ids"`
    Connection string   `json:"connection,omitempty"`
    Kind       string   `json:"kind"`  // title | metadata | both
    Force      bool     `json:"force,omitempty"`
    AIMode     string   `json:"aiMode,omitempty"`
}
type AISessionsAutoGenerateResponse struct {
    Queued  []string            `json:"queued"`
    Skipped []AutoGenSkipReason `json:"skipped"`
    Errors  []string            `json:"errors,omitempty"`
}
type AutoGenSkipReason struct {
    Id     string `json:"id"`
    Reason string `json:"reason"` // user-title | missing | no-messages | no-model | limit
}
```

服务层职责：
1. `managerForRequest`（沿用本地/远端路由）。
2. 逐个 `Summary` 校验：
   - `missing` → skip `missing`
   - `titleSource=="user" && kind in {title,both} && !force` → skip `user-title`
   - `messageCount==0` → skip `no-messages`
3. `ids` 超过 `MaxAutoGenerateBatch`（默认 50）→ 直接返回 error，不部分执行。
4. `enqueueManualGen` 后立即返回。
5. 模型不可用判断放在**前端**（`resolveMetadataAIMode`）避免后端重复推导；后端仍会在 worker
   `runOne` 里遇到 `GetAIOptsForMode` 错误时走重试。

### 2.5 metadata 落库路径

worker 的 metadata 分支调用 `GenerateSessionMetadata` 后，直接复用现有写入：
`Manager.SetNoteAndTags(ctx, key, note, tags)`（若不存在则用 `NoteAndTags` 服务层的同一实现提取到 manager）。
**不新增表/列**。`titleSource` 不受影响。

## 3. 前端

### 3.1 `aisession-gen-store.ts`（新，模块级）

仿 `session-note-cache.ts`：

```ts
type GenState = {
    state: "queued" | "running" | "done" | "failed";
    kind: string; attempt: number; maxAttempts: number; error: string;
    updatedAt: number;
};
// key: `${connection}|${sessionKey}|${kind}`
```

- `ensureGenListener()`：`waveEventSubscribeSingle` 订阅 `aisessions:generationstatus`，写入 map 并通知订阅者。
- `autoGenerate(service, ids, connection, kind, force, aiMode)`：封装 RPC + 本地乐观 queued；
  失败时写入 `failed`（RPC 本身的错误）。
- `useSessionGenerationStatus(sessionKey, connection, kind?)`：`useSyncExternalStore`。
- `done` 状态 3s 后自动回落 `idle`（纯 UI 反馈），`failed` 保留直到用户重试或关闭。

### 3.2 按钮三态（共享组件）

新 `frontend/app/view/aisessions/gen-action-button.tsx`：
- `idle` → `fa-wand-magic-sparkles`
- `queued/running` → `fa-spinner animate-spin`，disabled
- `failed` → `fa-triangle-exclamation text-warning`，点击 = 重试
- `done` → `fa-check text-accent`，1.2s 后回 idle

props：`{sessionId, connection, kind, force?, size?, onSkipped?}`。
内部调用 `resolveMetadataAIMode()`，unavailable 时直接弹错误条 + "Open AI settings"（复用
`createBlock({meta:{view:"waveconfig", file:"waveai.json"}})`）。

### 3.3 入口矩阵

| 入口 | 文件 | 形态 |
|---|---|---|
| agent card | `element/info-card/session-note-section.tsx` | **改造**：删阻塞提案面板，两个按钮换成 `GenActionButton`（title / metadata）；note 覆盖走 Undo |
| 列表行 | `view/aisessions/session-row.tsx` | hover 动作区加一个 wand 按钮 + popover（title / note&tags / both） |
| Detail 头栏 | `view/aisessions/session-detail.tsx` | Star 左侧加 `GenActionButton`(title)；note&tags 放 `SessionMoreMenu` |
| `···` 菜单 | `view/aisessions/session-menu.tsx` | 加 `Generate title with AI` / `Generate note & tags with AI` 两行 |
| 批量栏 | `view/aisessions/session-batch-bar.tsx` | `AI title` / `AI note+tags` 按钮 + `n/total done`；ids 来自选区 |

### 3.4 titleSource 视觉区分

新增 `frontend/app/view/aisessions/title-source-badge.tsx`：`titleSource==="ai"` 时渲染
`<i class="fa-sharp fa-solid fa-wand-magic-sparkles text-[9px] text-accent/70" title="AI-generated title" />`。

接入点：
- `session-row.tsx` 标题 div 之后（约 L420）。
- `session-detail.tsx` 标题 div 之后（约 L1363）。
- `use-block-session-title.ts` 返回 `{title, titleSource}`；`block.tsx` `InlineTabLabel` 会话分支渲染小图标。

`source_title` / `first_user_message` 不标（避免把"provider 原生标题"误标成 AI）。

### 3.5 Undo toast

`note` 非空时被静默覆盖：在 `GenActionButton` 成功回调里，前端保存旧 `{note, tags}`，
渲染一个 app 级 toast（复用现有 notification 能力；若无则用 `modalsModel` 之外的轻量 fixed 元素）。

- 10s 自动消失；
- 点 Undo → `service.NoteAndTags({id, note: old, tags: oldTags})` + 广播旧值；
- 新 note 已再次被改动（比较 `updatedAt`）→ Undo 按钮失效并提示 "Note changed again"。

### 3.6 编辑器内生成（子任务 `note-ai-inline`）

`note-ai-controls.tsx`：
- `useNoteAIGenerate(sessionId, connection)`：调 `GenerateMetadata`（提案接口，非 AutoGenerate），
  自动重试 2 次（1.5s / 4s），`loading/ready/error` 三态。
- `NoteAIButton` + `NoteAISuggestion`（Apply / Regenerate / Dismiss）。
- 草稿为空 → 生成成功后直接写入 `noteDraft`/`tagDraft`；非空 → 只显示建议条，点 Apply 才写入。
- 接入 `session-row.tsx` 行内编辑器、`aisessionnotemodal.tsx`、`session-detail.tsx` Note 弹窗。

> 与 3.3 的区别：编辑器里**不自动落库**，只填草稿，保存仍由各编辑器原有逻辑负责。

## 4. 兼容与回滚

- 新 RPC/事件是**纯增量**；旧 `GenerateTitle/GenerateMetadata` 保留（编辑器子任务仍用）。
- 前端所有新入口走 feature 开关？——不加。按钮本身就是显式操作，不需要额外开关；
  `ai:sessionautotitle` 仅控制自动巡检。
- 回滚：删除前端入口 + 保留 RPC 即可；后端 worker 的 manual 分支不参与自动巡检，停用无副作用。
- 远端：`AutoGenerate` 走 `managerForRequest`，远端由远端 wavesrv 的 worker 执行，
  状态事件经连接回传（沿用 `makeTitleUpdatedPublisher(connection)` 的模式）。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| `setMetaTx` 写 note 误清 title/source | 子任务 backend 先跑既有 `sqlite_index_test.go`；metadata 写入复用 `SetNoteAndTags` |
| 事件风暴（批量 50 条 × 4 状态） | 前端 store 按 key 合并；`done` 3s 回落；批量栏只聚合计数 |
| 重试耗尽后用户无感 | 终态 failed 事件 + 按钮 warning + tooltip 带 error |
| Undo 窗口内又被自动巡检覆盖 | Undo 以 `updatedAt` 做 CAS，过期则拒绝并提示 |
| 远端 connection 丢失导致状态串台 | 事件与 RPC 都带 `connection`，store key 含 connection |

## 6. 附：批注时间线 AI 生成的失败治理（2026-10-27 实测）

dev 日志里最近三次 `annotation-timeline` 失败（`ai_audit_log` #18/#19/#20，同一大会话
447 消息 / 688k 字符）根因各不相同，已按下面修掉：

| 现象 | 根因 | 修法 |
|---|---|---|
| `not valid JSON`（29.8s） | 输出上限写死 2048 token，12 条 × 600 字 body 写不完，JSON 被切断 | `annotationOutputBudget()` 按条目数/body 长度估预算（2048–8192） |
| 同上（32.7s） | 同上；第 2 次尝试又撞 429，错误被覆盖 | 截断修复 + 保留 `lastParseErr` 与 `lastTransportErr`（`annotationErrorText`） |
| 纯英文独白、无 JSON（46.9s） | 思考模型把预算花在推理上 | 剥 `<thinking>`/`</think>`、重试换「只许 JSON」系统提示，错误文案指向换非思考模型 |
| 即使解析成功也一条不剩 | 模型把 digest 里的 ` seq=618 role=tool` 一起抄进 anchorKey | digest 改「每行一个 JSON 对象」+ `normalizeAnnotationAnchorKey()` 截到首个空白 |
| 30–47s 延迟 / 429 | digest 200 节点 × 500 字 ≈ 10 万字符 | 降到 60 节点 × 240 字 + 24000 字符上限 |

用真实回复回归：`#18 → 19 条可用草稿`、`#20 → 7 条`、`#19` 正确归类为 `no-json`。

顺带修掉：`AuditInput` 缺 `SessionTitle` 导致 `audit_store_test.go` 编译不过，
并让 `AuditBegin` 在标题为空时按 sessionKey 回填（历史审计行 session_title 全空）。

### 6.1 后续：waveai@* 云端模式的 400（2026-10-27 13:11 实证）

切到 `waveai@balanced` 后，生成全部失败于：

```
failed to stream openai-responses chat: openai 400 Bad Request:
Invalid X-Wave-ClientId header: must be a valid UUID
```

根因：`pkg/aiusechat/completion.go` 里 headless 补全把 `WaveChatOpts.ClientId` 写成了字面量
`"completion"`，它会被当成 `X-Wave-ClientId` 发给 Wave AI 网关，而网关要求 UUID。
交互式聊天用的是 `wstore.GetClientId()`（应用启动时生成的 UUID），所以只有后台生成挂。

修法：`ClientId: wstore.GetClientId()`。**影响面**：标题 / Note / Tags / 批注四类后台生成，
只要用户选的是 `waveai@*` 云端模式就全挂；自定义 openai 兼容端点不校验该头，所以之前没暴露。

另外 `ai_audit_log.anchor_total` 之前恒为 0（`AuditBegin` 没传），已补成 digest 条目数，
审计页才能看出「这次给了多少候选节点」。

> 注：`orphaned: completion callback never arrived`（duration 0，model 空）是进程重启时
> 未完成的排队行被清扫器收尾的结果，属预期行为，不是新的失败。
