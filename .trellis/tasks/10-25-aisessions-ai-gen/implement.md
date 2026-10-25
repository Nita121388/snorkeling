# Implement: AI 会话标题 / Note / Tags 一键生成

> 三个子任务可并行：`gen-backend` → `gen-entries`（契约先对齐）→ `note-ai-inline`（完全独立）。
> 本文件只做总览与集成验收；细项在各子任务 `implement.md`。

## 阶段 0：基线（必做，先跑并记录）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/"
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/service/aisessionsservice/"
npx tsc --noEmit
```

- [x] 记录上述基线结果（改动前）。
- [x] 确认已完成任务 `10-24-aisessions-title-autogen` 的 `titleautogen_test.go` / `sqlite_index_test.go` 全绿。
- [ ] 回归风险点：`sqlite_index.go setMetaTx`（note/title/tags 互不覆盖）、`manager.go setAutoTitle`。

## 阶段 1：后端契约（子任务 gen-backend）

- [x] `genJob` 扩展 `kind/manual/force/attempt/aiMode`；pending 去重键 `key|kind`。
- [x] worker metadata 分支：`GenerateSessionMetadata` → `Manager.NoteAndTags`。
- [x] 手动 job 退避重试（2s/5s/15s，max 3）；自动 job 行为不变。
- [x] `GenerationStatusEvent` + `ManagerOptions.OnGenerationStatus` + `autoTitleQueue.publishStatus`。
- [x] 新 wps 事件 `aisessions:generationstatus`（`pkg/wps/wpstypes.go` 常量 + `AllEvents`）。
- [x] 新 RPC `AutoGenerate`（request/response/skip 原因/批量上限）。
- [x] `makeGenerationStatusPublisher(connection)` 在 `managerForRequest` 的两个分支都挂上。
- [x] `go generate` 重新生成 `frontend/types/gotypes.d.ts` / `waveevent.d.ts`（Taskfile `generate` 或 `go run cmd/generatets/main-generatets.go`）。
- [x] 单测：手动重试矩阵、自动 job 不回归、force 覆盖、metadata kind、批量上限、skip 原因。

**验收命令**：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/ ./pkg/service/aisessionsservice/ ./pkg/wps/"
```

## 阶段 2：前端状态层 + 入口（子任务 gen-entries）

- [ ] `aisession-gen-store.ts`：事件订阅、乐观 queued、`useSessionGenerationStatus`、done 回落。
- [ ] `gen-action-button.tsx`：三态图标 + `resolveMetadataAIMode` 前置校验 + Retry。
- [ ] `title-source-badge.tsx` + 三处接入（row / detail / tab）。
- [ ] agent card 改造：删阻塞提案面板，按钮换 `GenActionButton`；Undo toast。
- [ ] 列表行 hover 入口 + popover；Detail 头栏；`SessionMoreMenu` 两行；批量栏。
- [ ] 批量上限 50；超出提示收窄选区。
- [ ] 前端单测：store 合并/去重、button 三态、badge 渲染、批量计数。

**验收命令**：

```powershell
npx tsc --noEmit
npx vitest run frontend/app/store frontend/app/view/aisessions frontend/app/element/info-card
```

## 阶段 3：编辑器内生成（子任务 note-ai-inline）

- [ ] `note-ai-controls.tsx`（`useNoteAIGenerate` + `NoteAIButton` + `NoteAISuggestion`）。
- [x] 接入 `session-row.tsx` 行内编辑器、`aisessionnotemodal.tsx`、`session-detail.tsx` Note 弹窗。
- [x] 空草稿直填 / 非空走 Apply；自动重试 2 次；配置缺失引导。
- [x] 单测建议条 Apply/Dismiss、重试、草稿写入。

## 阶段 4：集成验收（手工）

- [ ] agent card 点标题生成：≤200ms 返回，卡片不闪、不弹窗，数秒后标题自更新。
- [ ] 列表行 / Detail 头栏 / 批量栏同样生效；批量 12 条逐个完成，失败单独标红可 Retry。
- [ ] `titleSource=user` 会话点生成 → 返回 skip，UI 提示"将覆盖自定义标题"并二次确认。
- [ ] note 非空时被覆盖 → Undo toast 出现，10s 内可恢复。
- [ ] 模型未配置 → 点击直接引导，无 90s 转圈。
- [ ] 断网/模型 500 → 自动重试 3 次后按钮 warning，tooltip 含错误。
- [ ] 远端 connection：列表与详情状态不串台；事件带回正确 connection。
- [ ] `ai:sessionautotitle` 关闭时：手动按钮仍可用；列表扫描零 AI 请求。

## 阶段 5：收尾

- [ ] `go test ./pkg/aisessions/ ./pkg/service/aisessionsservice/`
- [ ] `npx tsc --noEmit` + 改动文件 eslint
- [ ] `detect_changes()` 核对影响面（GitNexus）
- [ ] 更新 spec：`pkg/aisessions` 新增「手动生成 job / 状态事件 / 重试语义」到 `.trellis/spec/`
- [ ] 按子任务拆分 commit（backend / entries / note-inline）

## Review gate（提交前）

- [ ] `AutoGenerate` 请求路径 O(1)，无 AI 调用（grep 确认）。
- [ ] 自动巡检 job 的重试行为零变化（既有测试不改断言通过）。
- [ ] `user` 标题默认不被改写；note 静默覆盖有 Undo 且以 `updatedAt` 做 CAS。
- [ ] 状态事件带 `connection`，store key 含 connection。
- [ ] `go generate` 产物已提交，无手改生成文件。
