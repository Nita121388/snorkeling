# PRD: AI 会话标题 / Note / Tags 一键生成：后台静默执行、失败重试与视觉区分

## 背景（已核查的事实）

1. **AI 生成能力已在后端**：`pkg/aisessions/titlegenerate.go` `GenerateSessionTitle`、
   `pkg/aisessions/metagenerate.go` `GenerateSessionMetadata`；对应 RPC
   `AISessionsService.GenerateTitle` / `GenerateMetadata`（`pkg/service/aisessionsservice/aisessionsservice.go:1004 / 953`）。
2. **后台 worker 已在**：`pkg/aisessions/titleautogen.go`，串行 + 间隔限流，只由列表漏斗
   `enqueueAutoTitles` 喂养（`pkg/aisessions/manager.go:199/209`），且**只在 `ai:sessionautotitle` 开关打开时工作**。
   每个会话**至多一次**（成功/失败都写 `ai_title_attempted_at`）。
3. **`titleSource` 已贯通到前端**：`SessionSummary.titleSource`（`frontend/types/gotypes.d.ts:2325`），
   取值 `user / ai / source_title / first_user_message / project / id`。
   但前端**零渲染** —— 没有任何组件读它。
4. **唯一的一键入口在悬浮卡**：`frontend/app/element/info-card/session-note-section.tsx`，
   两个按钮走「阻塞提案 + Apply」：`setStatus("loading")` → `await GenerateTitle/GenerateMetadata`
   （模型调用最长 90s）→ 渲染 `Generating title…` / 建议面板 → 用户点 `Apply` 才落库。
5. **真正编辑 note/tag 的三处没有 AI 能力**：
   - `frontend/app/view/aisessions/session-row.tsx` 行内编辑器（`Clear` + 保存状态，无 AI）；
   - `frontend/app/modals/aisessionnotemodal.tsx`（`Clear` / `Close`，无 AI）；
   - `frontend/app/view/aisessions/session-detail.tsx:1706` 的 Note 弹窗（`Clear` / `Close`，无 AI）。
   三处各自维护 `noteDraft/tagDraft`，落库分别走 `onNoteSave` / `service.NoteAndTags` / `model.updateNote`。
6. **广播链路已在**：worker 成功后经 `pkg/service/aisessionsservice/aisessionsservice.go:288`
   `makeTitleUpdatedPublisher` 发 `aisessions:titleupdated`；前端 `session-note-cache.ts:165+`
   订阅并 `applyTitleUpdate`（只 merge title/titleSource，不覆盖 note/tags），
   `aisessions.tsx:1633` / `agent.tsx:698` 另有一条 `aisession-note-updated` DOM 事件驱动 `model.replaceSession`。

## 目标

1. **所有入口点击即静默入队**：agent card、列表行、Session Detail 头栏、`···` 菜单、批量栏。
   用户点了不需要等、不需要二次确认，按钮只表达 queued/running/failed。
2. **后台串行生成并直接落库**：标题写 `titleSource=ai`，note/tags 写既有 meta 表。
3. **失败退避重试**：手动触发的 job 失败按 2s / 5s / 15s 退避，最多 3 次；终态失败 UI 给 Retry。
   自动巡检 job **保持至多一次**（不回归 `10-24-aisessions-title-autogen` 的行为）。
4. **标题来源可辨**：列表行 / Detail 头栏 / Tab 标签对 `titleSource=ai` 显示小图标 + tooltip。
5. **Note 静默覆盖可撤销**：静默写入后用 10s 可撤销的 toast 兜底，不弹确认对话框。
6. **编辑器内生成填草稿**：已打开的编辑器走「生成 → 填入草稿」而非直接落库，避免覆盖正在输入的内容。

## 非目标

- 不改 `first_user_message` / `source_title` / `project` / `id` 的标题生成规则。
- 不做「消息变多自动重生成」。
- 不改 `ai:sessionautotitle` 开关的默认值与语义（自动巡检默认关）。
- 不动 `setMetaTx` 的合并逻辑（`titleSource` 写路径已在 `10-24-aisessions-title-autogen` 完成）。
- 不做多语言 / 标题翻译。
- 不做生成历史 / 批量结果报表。

## 约束

- **性能红线**：入队 RPC 只做内存写 + 非阻塞 poke，请求路径零 AI 调用；worker 单 goroutine 串行 + 间隔限流。
- **用户数据优先**：`titleSource=user` 的标题默认不被静默覆盖；非空 note 被覆盖必须可撤销。
- **可感知**：任何 job 的状态必须能从前端读到（新事件），失败不能无声无息。
- **幂等**：同一会话 + 同一 kind 的 job 在 pending 中去重；成功的 job 不再重复入队。
- **平台**：前后端都跑（无平台特化）。后端改动须保持 `go test ./pkg/aisessions/` 全绿。

## 用户故事

1. 我在 agent card 上点标题生成按钮，图标转两秒圈，然后标题自己变了，我全程可以继续干别的。
2. 我批量选了 12 个会话点 `AI title`，列表行逐个变标题，失败的标红，我可以单独 Retry。
3. 我手改过标题的会话，点 AI 生成会先问我一句，不会偷偷改掉。
4. 我的会话里手写了一篇 note，点 AI 生成后 note 被替换，底部弹了个 10 秒的 Undo，我点一下就回来了。
5. 列表里我能看出哪个标题是 AI 生成的（小魔杖图标），哪个是我自己改的。
6. 我正在 Note 弹窗里打字，点 AI 生成，它把建议填进我的草稿，不会在我手指下面直接保存。
7. 模型没配好时，点生成直接告诉我去哪开配置，不会转 90 秒圈然后报错。

## 验收标准

- [ ] agent card 两个按钮点击后 **≤200ms** 返回（无阻塞式 await 在调用方）。
- [ ] 点击后标题/note/tags 在后台落库，卡片无需刷新即显示新值（经既有广播链路）。
- [ ] 手动 job 失败自动重试 3 次，退避间隔约 2s/5s/15s；第 3 次仍失败则按钮变 warning + 可点 Retry。
- [ ] 自动巡检 job 仍为至多一次（`titleautogen_test.go` 既有断言不回归）。
- [ ] `titleSource=user` 的会话默认被 skip，RPC 响应里返回 skip 原因；`force=true` 才覆盖。
- [ ] note 静默覆盖后出现 Undo toast，10s 内可恢复到旧 note+tags。
- [ ] 列表行 / Detail 头栏 / Tab 标签对 `ai` 标题显示 `fa-wand-magic-sparkles` 小图标，hover 有 tooltip。
- [ ] 模型未配置（`resolveMetadataAIMode()` 返回 unavailable）时，点击给出引导文案 + 打开设置入口，**不发 RPC**。
- [ ] 批量入口对 `ids.length` 有上限（默认 50），超出返回错误并提示收窄选区。
- [ ] `go test ./pkg/aisessions/ ./pkg/service/aisessionsservice/` 全绿；前端 `npx tsc --noEmit` 无新增错误。
- [ ] `go generate` 后 `frontend/types/gotypes.d.ts` / `waveevent.d.ts` 含新 RPC 与新事件类型。

## 子任务拆分

- `10-25-aisessions-gen-backend` —— RPC + worker 通用化 + 重试 + 状态事件（后端）。
- `10-25-aisessions-gen-entries` —— gen-store + 各入口按钮 + titleSource 视觉区分 + Undo（前端）。
- `10-25-aisessions-note-ai-inline` —— 编辑器内 AI 生成填草稿（前端，可独立上线）。

三者可并行开发；`gen-entries` 依赖 `gen-backend` 的 RPC 契约，先用 mock 对齐即可。

## Notes

- 与 `10-24-aisessions-title-autogen` 的关系：本任务**复用**其 worker/存储/开关，不重做；只补「手动入队入口 + 状态 + 重试」。
- 与 `10-24-aisessions-note-dialog` 的关系：`note-ai-inline` 子任务给三个编辑器补 AI 能力，不改它们的保存/自动保存语义。
