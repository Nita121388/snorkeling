# 进度记录 — agent-card-model-provider（2026-11-19 下班存档）

> 晚上继续开发从这里接手。任务状态：`in_progress`。
> 父任务：`11-19-agent-card-model-title-display`；兄弟任务：`11-19-agent-card-title-source-marker`（planning，但标记代码已在本任务里一并落地）。

## loop 台账状态

- 包：`N-1119-agent-card-display`（bug / P1 / S3，task 指向父任务）。
- G2 红证已登记 clear；`queue approve` 已入队；`queue run --emit-pick` 已落 pick（running）。
- 红证明细：`loop/red/N-1119-agent-card-display.txt`。
- 验收判据（`queue prove` 会用）：
  - `node scripts/verify/agent-card-model/verify.mjs` → `12/12 PASS`（**验证台还没建，见 TODO**）
  - `npx vitest run frontend/app/view/term/ frontend/app/agent-status/ frontend/app/tab/ && echo VITEST_OK`
  - `go test ... && echo GO_OK`（PowerShell + `use-local-env.ps1`）
  - `npm run i18n:check && echo I18N_OK`
  - `node scripts/check-tsc-baseline.mjs` → `<=47`

## 已完成（代码在 working tree，未 commit）

### 红证测试（6 个文件，均已落盘）

- `pkg/aisessions/provider_pi_test.go`：`TestPiCurrentModelState`（model_change 在最后 assistant 之后 / 同文件废弃分支 / >1MiB 行后仍能找到 model_change）
- `pkg/aisessions/provider_codex_test.go`：`TestCodexCurrentModelState`、`...FallsBackToMessageModel`
- `pkg/service/aisessionsservice/chatcontrol_test.go`：`TestLiveSessionStateCurrentModel`、`TestCurrentModelStateDoesNotLoadMessages`
- `frontend/app/view/term/agent-identity.test.ts`：6 个拆分/格式化用例
- `frontend/app/agent-status/agent-runtime-metadata-store.test.ts`：TTL 复合键 / 失败不缓存
- `frontend/app/view/term/agent-card-title-source-mark.test.tsx`：3 个标记用例 + 共享 badge 不变

### 产品代码（已改）

- Go
  - `pkg/aisessions/types.go`：`ModelState` / `ModelStateProvider` / `Manager.CurrentModelState`；`readModelStateTailLines`（`ReadBytes('\n')`、1 MiB / 2000 行、丢窗口残行、超长行继续扫）。
  - `pkg/aisessions/provider_pi.go`：窗口内 `id/parentId` 回溯活跃 leaf；**窗口到顶时 break 而不是 ok=false**（修掉大文件回退整场 Load）；`ok = Model != ""`。
  - `pkg/aisessions/provider_codex.go`：尾部 `turn_context.payload.model` + 文件头 64 KiB `session_meta.payload.model_provider`；回落最后 message.model。
  - `pkg/service/aisessionsservice/chatcontrol.go`：磁盘兜底顺序 live → `CurrentModelState`（命中即返回，不 `manager.Load`）→ 未命中才原逻辑；`ModelProvider` 不再写 `summary.Source`。
- 前端
  - `frontend/app/view/term/agent-identity.ts`：`resolveAgentModelIdentity`（只拆第一个 `/`、agent 类型 provider 无效）+ `formatAgentModel`（大小写不敏感去重、`provider · model`）。
  - `frontend/app/agent-status/agent-runtime-metadata-store.ts`：键 `blockId|sessionId|source`；只有成功 model 才 `loadedAt`；失败只 `lastAttemptAt`；raw 取 `modelId || modelName`；换会话清旧模型。
  - `frontend/app/view/term/agent-hover-card.tsx`：identity + formatAgentModel；displayProvider = vendor || identity.provider || providerLabel；副标题不再 `humanizeKey(titleSource)`，改小标记；tooltip 保留 raw。
  - `frontend/app/view/term/agent-card-title-source-mark.tsx`：card-local 标记（`agent-card-title-source-mark` class + `data-title-source`；ai ✨ / first_user_message 消息图标；tooltip 含原文）。
  - `frontend/app/tab/tab-more-agent-card.tsx`：mini 行用同一套拆分/格式化，**不调用 ensure（零 RPC）**。
  - `frontend/i18n/locales/{zh,en}/term.json`：`titleFromAI` / `titleFromFirstMessage`。
  - `pkg/service/aisessionsservice/chatcontrol_test.go`：修正 fixture 文件名/摘要 key（文件名必须是 `pi-live-model-fresh.jsonl`，与 session id 一致）。

### 已跑绿的测试（本轮最后状态）

- `go test ./pkg/aisessions/ -run 'TestPiCurrentModelState|TestCodexCurrentModelState' -v` → PASS（pi 3 子用例、codex 2 个）
- `go test ./pkg/service/aisessionsservice/ -run 'TestLiveSessionStateCurrentModel|TestCurrentModelStateDoesNotLoadMessages' -v` → PASS，输出 `load_calls=0/0 PASS`
- `npx vitest run frontend/app/view/term/agent-identity.test.ts frontend/app/agent-status/agent-runtime-metadata-store.test.ts frontend/app/view/term/agent-card-title-source-mark.test.tsx` → **3 files / 13 tests passed**

## 晚上继续的 TODO（按顺序）

1. **补 Go 顶层测试名**（验收命令里引用了但还没单独定义）：
   - `TestCurrentModelStateBudget`：用 3000 行 fixture 断言 `readModelStateTailLines` 返回 ≤2000 行；3MiB 文件下 `CurrentModelState` 仍 ok。
   - `TestCurrentModelStateSkipsOversizedLine`：可把现有 subtest 提成顶层同名测试，或直接包一层。
   - 可选：codex 头 provider 的“>1MiB padding 后仍能读 session_meta”用例。
2. **建验证台**：复制 `scripts/verify/_template/verify.mjs` → `scripts/verify/agent-card-model/verify.mjs`，固定 12 条断言（模型切换无新回复更新 / provider 与模型分两处 / raw 在 tooltip / 副标题无 First User Message / first_user_message 有标记 / ai 有 ✨ / user 无标记 / mini 行零 RPC + 其余四条 hover/modal 一致性）；登记 `scripts/verify/README.md`；先跑一次并采集 **修复前 p95 基线**（当前产品代码已改，若还要基线需 `git stash` 或用当前实现作为基线并记录口径，二选一并在文档写明）。
3. **全量回归**：
   - `npx vitest run`（期望 VITEST_OK / FAIL=0）
   - `go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/...`（**Windows 链接 OOM 时用**：直接走 `.tools/go/bin`，并 `GOFLAGS='-p=1 -ldflags=-s -w'`）
   - `npm run i18n:check`（I18N_OK）
   - `node scripts/check-tsc-baseline.mjs`（≤47）
4. `node E:/primary/projects/loop/bin/loop.mjs queue prove --id N-1119-agent-card-display --root .` 采数字。
5. 派 `trellis-check` 做质量复核；`detect_changes`（GitNexus 索引已 stale，10-22 vs 当前 commit，必要时先 `node .gitnexus/run.cjs analyze`）。
6. 提交（单 commit），再 G7 人验收 / `accept --solution fixed` / `release`。
7. 处理兄弟任务 `11-19-agent-card-title-source-marker`：标记代码与测试已随本任务落地，把该任务状态同步（避免重复实现）。
8. 清理 `tmp/add-loop-1119.mjs`、`tmp/find-pi-model-switch.mjs`、`tmp/go-red*.txt`、`tmp/vitest-red.txt` 等临时文件（任务收尾时）。

## 环境注意

- 直接 `go` 不在 bash PATH；用：
  `export PATH="/e/code/snorkeling/.tools/go/bin:$PATH" GOCACHE="E:/code/snorkeling/.cache/go-build" GOMODCACHE="E:/code/snorkeling/.cache/gomod" GOPATH="E:/code/snorkeling/.cache/gopath" GOENV=off GOTOOLCHAIN=local GOPROXY="https://goproxy.cn,direct"`
- PowerShell 调 go 的 stderr 会被包装成 NativeCommandError，抓完整编译错误时优先用 bash + `.tools/go/bin`。
- 链接偶发 `ld: memory exhausted`：加 `GOFLAGS='-p=1 -ldflags=-s -w'` 串行重试。
- 工作区里还有**其他并行会话**改的 `frontend/app/block/*`、`commontext/*`、`agentcontrol/*`、`agentdata/*`、`docs/project/*` 等；不是本任务产物，提交时只 stage 本任务文件。

## 关键决策（沿用）

- 当前模型 = 会话活跃 leaf 上最新的 `model_change`；不是最后一条 assistant 消息。
- 后端只返原始串 + 会话 provider；拆分只在前端 `resolveAgentModelIdentity` 一处。
- Tab mini 行零 RPC；只有 hover/modal 富化。
- 标题标记 card-local，共享 `TitleSourceBadge` 保持 `ai`-only。
