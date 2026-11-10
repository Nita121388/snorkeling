# CommonText 冲突：一键复制给 agent + 粘回 resolve

> 父任务：11-10-copy-for-agent
> 依赖：cfa-core（`<CopyForAgent>` + `buildAgentPayload`）
> 关联：11-07-commontext-cloud-sync / 11-09-commontext-sync-config-fixes（同一条同步线）

## Background（现状断点，有代码证据）

1. 渲染能力已完备：`pkg/syncconflict/render.go` 的 `RenderMarkdown` / `RenderAll` 产出
   **自包含的 AI 可粘贴块**——两侧全文、只列冲突字段、结尾 `### Task` + 输出契约
   "Reply with the merged content only — no explanation, no code fences"。
2. 只有 CLI 出口：`cmd/wsh/cmd/wshcmd-commontext-sync.go:176` `conflicts --copy`。
3. 设置面板没有入口：`frontend/app/view/waveconfig/syncsettings.tsx` 的 Status 组
   「Unresolved conflicts」只把小字描述写成「Run `wsh commontext-sync conflicts --copy`」，
   用户必须切终端、记命令、再粘回对话——这正是「解释半天」的摩擦。
4. 回程同样只有 CLI：`wsh commontext-sync resolve <id> --text-file merged.md`。
   复制出去之后若不补回程，摩擦只是从「解释」挪到「执行」。

## Goal

冲突行右侧一键复制（`Copy for agent`），冲突抽屉内逐条「Paste merged → Resolve」，
全程不离开设置面板。

## Requirements

### R1 后端 RPC

- 新增 `CommonTextService.SyncConflictsCopy` → `{ count: number; text: string }`，
  内部直接调 `syncconflict.List()` + `syncconflict.RenderAll()`；**渲染留在 Go**，前端不复制格式化逻辑。
- 新增 `CommonTextService.SyncConflicts` → 结构化条目（id/title/fields/transport/deviceName/detectedAt），
  供抽屉列表渲染（避免前端解析 Markdown）。
- 新增 `CommonTextService.SyncResolve` → `{ id, text }`，等价 `resolve <id> --text-file`，
  复用既有 resolve 路径（不得二次实现合并逻辑）。
- 三者都注册进 wshrpc 类型与 `frontend/types/gotypes.d.ts`（走既有生成流程，不手改 d.ts）。

### R2 面板接线

- Status 组「Unresolved conflicts」行：冲突数 > 0 时右侧出现 `<CopyForAgent>`，
  title 为 `Copy all N conflicts for an AI to merge`；冲突数 = 0 时按钮不渲染（不摆一个必然失败的按钮）。
- 行描述改为「Conflict details can be copied to an AI; nothing is overwritten.」，
  并保留 CLI 等价命令作为次级提示（不删，agent 仍需要）。
- 冲突数 > 0 时该行右侧再给一个「Review」入口打开冲突抽屉。

### R3 冲突抽屉（回程）

- 每条冲突：标题 + `fields` + `from <device> · detected <time>` + 该条 `<CopyForAgent>`（单条复制）。
- 每条给 `Paste merged` 输入区（或按钮读取剪贴板）+ `Resolve`；成功后刷新
  `SyncStatus.conflicts` 计数，抽屉自动移除该条。
- 失败（文本为空 / 记录已不存在）给出可读错误，不静默。

## Acceptance（命令 → 期望输出）

- [x] `go test ./pkg/service/commontextservice/... ./pkg/syncconflict/...` → 全绿（新增 `commontextservice_test.go` 5 个用例：SyncConflictsCopy == RenderAll 逐字节、单条渲染、resolve happy path（rev bump）、校验拒绝不动存储）。
- [x] 面板复制出的文本与 CLI **同一渲染源**（`SyncConflictsCopy` 返回 == `syncconflict.RenderAll`，由 Go 测试锁死）。
- [x] `grep -c "### Task"` ≥ 1；`grep -c "Reply with the merged content only"` ≥ 1 —— 真机 verify `payload-task-section` / `payload-output-contract` 断言锁死。
- [x] conflicts == 0 时 `data-copy-for-agent` 不渲染 —— 真机 verify `panel-copy-hidden-at-zero` / `panel-review-hidden-at-zero`。
- [x] Resolve 回程：粘回合并文本 → Resolve → 冲突从列表消失（Go happy path + modal 单测；真机抽屉断言到 resolve 入口存在）。
- [x] 真机验证台：新 area `scripts/verify/sync-conflict-copy/verify.mjs` → **14/14 全绿**（launch+reset），台账已记；area 已登记 README。

## Touch（白名单）

- `pkg/service/commontextservice/commontextservice.go`
- `pkg/wshrpc/wshrpctypes.go`（RPC 类型）
- `frontend/app/view/waveconfig/syncsettings.tsx`
- `frontend/app/modals/`（新增冲突抽屉组件时）
- `frontend/types/gotypes.d.ts`（生成物）

## Out of Scope

- 冲突「自动合并」（不调 AI，不猜）。
- 冲突策略配置（已有 Conflicts 三选一）。
