# Implement: AI 会话标题 —— Tab 分层显示 + 后台异步 AI 标题生成

> 分两步。第一步可独立上线；第二步依赖第一步的 titleSource 语义（可并行开发，串行合入）。

## 阶段 0：基线（必做，先跑）

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/"`
  记录基线通过。
- [ ] 记住回归风险点：`sqlite_index.go` `setMetaTx`（note/title/tags 互不覆盖）、`manager.go SetTitle`。

## 阶段 1：Tab 分层显示（纯前端 meta，零 RPC）

### 1.1 建块补 projectPath
- [ ] `frontend/app/view/aisessions/aisessions.tsx` `openSessionDetail` →
      `openAISessionDetailFromList(session.key, model.blockId, { forceNewBlock, cwd: session.projectPath })`
- [ ] `frontend/app/view/aisessions/session-detail.tsx` 两处子代理卡片 `onOpenSession` 同理（能拿到 projectPath 就传）
- [ ] `session-detail-block.ts`：`openAISessionNewChatFromList` 增加可选 `cwd` 参数并写入 `cmd:cwd`

### 1.2 InlineTabLabel 分层
- [ ] `frontend/app/block/block.tsx` `InlineTabLabel.defaultTitle`：在 `frameTitle` 短路**之前**插入
      会话类 block 分支（`isSessionDetailBlockMeta` / `isChatBlockMeta`），逻辑：
      1. `customTitle`（已有，最高）
      2. `summary.title`（第二步接入，先留占位/跳过）
      3. `basename(meta["cmd:cwd"])`，远端拼 ` · connection`
      4. `frameTitle` 兜底
- [ ] `fullPath` tooltip 分支补会话类 block（cmd:cwd 全文 + connection）
- [ ] 导入 `isSessionDetailBlockMeta` / `isChatBlockMeta`（`@/app/block/block-info-card-meta`），
      确认不引入循环依赖（该文件只依赖 term agent-meta，安全）

### 1.3 验证 1
- [ ] `npx vitest run frontend/app/block` （如有相关测试）
- [ ] 手动：开两个不同项目会话详情 tab，名字不同；hover 有完整路径；远端显示 `· connection`
- [ ] 手动：`newchat` tab 不为空

## 阶段 2：AI 标题管道

### 2.1 数据层 titleSource
- [ ] `pkg/aisessions/metastore.go`：`sessionMeta` 加 `TitleSource` / `AITitleAttemptedAt` /
      `AITitleAttemptMessageCount`；`Apply` 读回；新增 `SetAutoTitle`、`MarkAITitleAttempt`
- [ ] `pkg/aisessions/sqlite_index.go`：
  - [ ] `ensureMetaAutoTitleColumns`（pragma 检查 + ALTER 3 列）
  - [ ] `setMetaTx` **合并化重构**（existing 为基底，按 source 覆盖）+ SELECT 读新列
  - [ ] `ApplyMeta` / `applyBatchMeta` 用 `title_source`（空→user）
  - [ ] 新增 `SetAutoTitle`（source `sqlite-ai-title`）、`MarkAITitleAttempt`（source `sqlite-ai-title-attempt`）
- [ ] `pkg/aisessions/manager.go`：
  - [ ] `SetAutoTitle(ctx, key, title)` 双写（sqlite + meta）
  - [ ] `MarkAITitleAttempt(ctx, key, messageCount)`
  - [ ] `summaryFromRow` / 转换处带上新字段

### 2.2 队列
- [ ] 新文件 `pkg/aisessions/titleautogen.go`：
  - [ ] `autoTitleEligible(SessionSummary) bool`（纯函数）
  - [ ] `autoTitleQueue` + lazy worker (`sync.Once`) + 串行 + interval + batchSize
  - [ ] `runOne(ctx, job)`：recheck → Load → GenerateSessionTitle → SetAutoTitle/广播 → 必 MarkAITitleAttempt
  - [ ] `(m *Manager) enqueueAutoTitles(summaries)`（O(1)、非阻塞）
- [ ] `ScanListResult` 两个返回点前调用 `m.enqueueAutoTitles(result.Sessions)`
- [ ] 生成完成广播走现有 `AiSessionNoteUpdated` 等价路径（参考 services 层现有 note 广播）

### 2.3 配置
- [ ] `pkg/wconfig/settingsconfig.go` 加 3 个字段（指针，默认关/1500/20）
- [ ] `autoTitleEnabled()` helper

### 2.4 前端设置开关
- [ ] `frontend/app/view/waveconfig/aipromptsettings.tsx`：`session-title` 卡片下加
      「Auto-generate titles in background」checkbox + 间隔/批量（可选，先只做 checkbox）
- [ ] 写盘 `RpcApi.SetConfigCommand(TabRpcClient, { "ai:sessionautotitle": true })`

### 2.5 tab 接入 summary.title
- [ ] 新 hook `useBlockSessionTitle(blockId)`（仅 active/hover 订阅，见 design §6.2）
- [ ] `block.tsx` 分层分支第 2 层接上 `useBlockSessionTitle`

### 2.6 验证 2
- [ ] 单测：
  - [ ] `titleautogen_test.go`：eligibility 矩阵（user/ai/source_title/attempted/missing 全跳过；首条消息通过）
  - [ ] `sqlite_index_test.go`：写 note 不清 title/title_source；写 ai-title 不动 note/tags/marked；
        读回 title_source=ai；attempt 幂等（两次 MarkAITitleAttempt 不重置）
  - [ ] `metastore_test.go`：Apply 读回 TitleSource
- [ ] 开关关：grep 日志确认 `GenerateSessionTitle` 未被调用
- [ ] 开关开：手动触发一次 List，观察 worker 串行、间隔、生成后 tab/列表标题变化
- [ ] 手动改名后重扫，确认不覆盖

## 阶段 3：收尾

- [ ] `go test ./pkg/aisessions/ ./pkg/wconfig/`
- [ ] 前端 lint/type：`npx tsc --noEmit`（或项目脚本）+ eslint 改动文件
- [ ] `detect_changes()` 核对影响面（GitNexus）
- [ ] 更新 spec（`pkg/aisessions` 标题语义）到 `.trellis/spec/`
- [ ] 提交（按任务拆分 commit，阶段 1 / 阶段 2 分开）

## Review gate（提交前）

- [ ] `setMetaTx` 合并化有专项测试且全绿
- [ ] 无阻塞调用落在 `ScanListResult` / `enqueueAutoTitles`
- [ ] `user` 标题在任何路径都不会被自动通道改写
- [ ] 开关默认关，关时零 AI 请求
