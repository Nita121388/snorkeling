# Implement: AutoGenerate RPC 与后台 worker 通用化

## 0. 基线

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/ ./pkg/service/aisessionsservice/"
```

- [ ] 记录基线。回归风险点：`autoTitleEligible`、`markAITitleAttempt` 幂等、`setMetaTx`。

## 1. 队列通用化（`pkg/aisessions/titleautogen.go`）

- [ ] `genKind` 常量 + `genJob` 字段扩展（`kind/manual/force/attempt/aiMode/connection`）。
- [ ] `autoTitleQueue.pending` 改 `map[string]genJob`，去重键 `key|kind`。
- [ ] `push` 保持 O(1)、非阻塞 poke。
- [ ] `run()` 移除 `autoTitleEnabled()` 检查（开关只 gates 自动入队）。
- [ ] `runOne` 按 `kind` 分派：`title` / `metadata` / `both`。
- [ ] 成功：`title` → `setAutoTitle`；`metadata` → `NoteAndTags`；`both` 串行。
- [ ] `status(job, state, err)` 统一发事件。
- [ ] `onFailure`：manual 走 `manualRetryBackoff` + `time.AfterFunc`；自动 job 行为不变。
- [ ] `manual` job 成功/终态失败后不再写自动 attempt 标记（避免误伤自动巡检语义）。

## 2. 状态事件

- [ ] `pkg/aisessions/types.go` 加 `GenerationStatusEvent`。
- [ ] `ManagerOptions.OnGenerationStatus` + `Manager` 字段 + `NewManagerWithOptions` 透传。
- [ ] `autoTitleQueue.publishStatus` 赋值。
- [ ] `pkg/wps/wpstypes.go` 加 `Event_AISessionsGenerationStatus` + `AllEvents`。

## 3. metadata 生成下沉

- [ ] `pkg/aisessions` 新增 `PromptConfigForFeature(feature string) wconfig.AIPromptConfigType`
      （把 service 层 `promptConfigForFeature` 逻辑下沉）。
- [ ] `pkg/service/aisessionsservice` 改为调用该函数（删私有重复实现）。
- [ ] `runMetadata` 实现：`GenerateSessionMetadata` → `Manager.NoteAndTags`。

## 4. RPC `AutoGenerate`

- [ ] `pkg/service/aisessionsservice/aisessionsservice.go` 加 `AutoGenerate_Meta` + `AutoGenerate`。
- [ ] `Manager.enqueueManualGen(jobs []genJob)`（`titleautogen.go`）。
- [ ] `makeGenerationStatusPublisher(connection)`（仿 `makeTitleUpdatedPublisher`）。
- [ ] `managerForRequest` 两个分支都挂 `OnGenerationStatus`。
- [ ] 批量上限常量 `MaxAutoGenerateBatch = 50`。
- [ ] skip 原因：`missing` / `no-messages` / `user-title` / `no-model`（前端已前置，后端兜底）。
- [ ] `kind` 白名单校验。

## 5. 类型生成

- [ ] 运行 `go generate`（或 `go run cmd/generatets/main-generatets.go`），确认
      `frontend/types/gotypes.d.ts` 出现 `AISessionsAutoGenerateRequest/Response`、
      `waveevent.d.ts` 出现 `aisessions:generationstatus`。
- [ ] 不手改生成文件。

## 6. 测试

- [ ] `titleautogen_test.go`：
  - manual 3 次失败状态序列；
  - `force` 覆盖 user 标题；
  - `kind=metadata` 不动 title；
  - `kind=both` 两步；
  - pending `key|kind` 去重；
  - 自动 job 既有断言不变。
- [ ] service 测试：批量上限、非法 kind、skip 原因、空 ids。
- [ ] `go test ./pkg/aisessions/ ./pkg/service/aisessionsservice/ ./pkg/wps/`

## 7. 收尾

- [ ] `detect_changes()` 核对影响面。
- [ ] spec 更新：`.trellis/spec/` 记录「手动生成 job / 状态事件 / 重试语义 / force」。
- [ ] commit（后端单条）。

## Review gate

- [ ] `AutoGenerate` 请求路径无 AI 调用（grep `RunCompletion` 不在该路径）。
- [ ] 自动巡检 job 重试行为零变化。
- [ ] 事件均带 `connection`。
- [ ] 生成产物已生成且无手改。
