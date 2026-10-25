# PRD: AutoGenerate RPC 与后台 worker 通用化（标题/Note/Tags + 失败重试）

## 背景（已核查）

- 队列已在：`pkg/aisessions/titleautogen.go` —— `autoTitleQueue`（pending map + order + cap-1 wake），
  进程级 registry `autoTitleWorkers` 按 index path 单例，单 goroutine 串行。
- 现有 job 只做标题：`autoTitleJob{key, source, projectPath, messageCount}`，
  `runOne` → `GenerateSessionTitle` → `setAutoTitle` → `markAITitleAttempt`。
- 开关：`ai:sessionautotitle`（`autoTitleEnabled()`）；批量 `ai:sessionautotitlebatchsize`；间隔 `ai:sessionautotitleintervalms`。
- 入口只有列表漏斗：`pkg/aisessions/manager.go:199/209` `enqueueAutoTitles`。
- 落库路径已有：`Manager.setAutoTitle`（source=ai）、`Manager.NoteAndTags`（sqlite 写 + ApplyMeta）。
- 事件链路已有：`Event_AISessionsTitleUpdated = "aisessions:titleupdated"`（`pkg/wps/wpstypes.go:39`），
  service 层 `makeTitleUpdatedPublisher(connection)`（`pkg/service/aisessionsservice/aisessionsservice.go:288`）挂在
  `managerForRequest` / 本地分支的 `ManagerOptions.OnTitleUpdated`。

## 目标

1. 新 RPC `AISessionsService.AutoGenerate`：批量入队、**立即返回**、返回 queued/skipped/errors。
2. worker 通用化：`kind = title | metadata | both`。
3. 手动 job **失败退避重试**（2s/5s/15s，最多 3 次）；自动 job **保持至多一次**（不回归）。
4. 新增 `aisessions:generationstatus` 事件，覆盖 queued/running/done/failed 四态，带 connection。
5. `force` 语义：允许覆盖 `titleSource=user`；非空 note 覆盖由前端负责 Undo，后端只执行。
6. 批量上限默认 50，超出拒绝。

## 非目标

- 不做进度持久化 / 断点续传（队列是进程内存态，重启后 pending 自然清空）。
- 不做跨 index path 的全局队列（维持 per-index 单例）。
- 不改 `ai:sessionautotitle` 开关语义与默认值。
- 不加 `AIMode` 的后端推断（前端传，worker 透传）。

## 约束

- **请求路径零阻塞**：`enqueueManualGen` 只做 map 写 + 非阻塞 poke，禁止 `Summary` 之外的重 IO。
  （session 校验用已有的 index 读，不做 AI、不做文件扫描。）
- **串行不变**：仍是单 goroutine，两 job 之间保留 `autoTitleInterval()`。
- **幂等**：`pending[key|kind]` 去重；成功/终态失败后从 pending 移除。
- **重试不放宽间隔**：重试退避独立于 `autoTitleInterval`，用 `time.AfterFunc` 唤醒。

## 用户故事

1. 作为用户，我在远端连接里点生成，标题在远端生成并回传，本地 UI 不串台。
2. 作为用户，模型报 500 后它会自己再试两次，第三次还失败才告诉我失败。
3. 作为用户，我不开自动开关时，手动按钮照样能用。

## 验收标准

- [ ] `AutoGenerate` 对 50 个 id 的返回延迟不含任何 AI 调用（压测/日志验证）。
- [ ] `kind=metadata` 生成的 note/tags 落库正确，且不动 `title` / `titleSource`。
- [ ] `kind=both` 在一个 job 内串行完成两步。
- [ ] `manual` job 失败后 3 次自动重试，每次 `generationstatus(failed, attempt=n)` 有事件；
      第 3 次后 `state=failed, attempt=3, maxAttempts=3`。
- [ ] `autoTitleEligible` 对自动 job 的判定与既有测试完全一致。
- [ ] `force=false` 时 `titleSource=user` 被 skip，reason=`user-title`。
- [ ] `ids` > 50 返回 error，`queued` 为空。
- [ ] 事件带 `connection`（远端场景）。
- [ ] `go test ./pkg/aisessions/ ./pkg/service/aisessionsservice/ ./pkg/wps/` 全绿。
- [ ] `go generate` 后 TS 类型含 `AutoGenerate` 与 `aisessions:generationstatus`。
