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

## 收尾追加（2026-11-19 夜班 worker，按 TODO 1→4 执行）

### ① 补齐两个顶层 Go 测试（均绿）

- `TestCurrentModelStateSkipsOversizedLine`：已从 `TestPiCurrentModelState` 的 `oversized_line_then_model_change` subtest 提升为同名顶层测试（原 subtest 保留但 `t.Skip` 指向新名字，避免双跑）。
- `TestCurrentModelStateBudget`：两阶段 —— ①3000 行小行 fixture（文件 < 1 MiB，窗口覆盖全文件）断言 `readModelStateTailLines` 返回 == 2000（`lines<=2000 PASS`，行上限真的咬住）；②3.5 MB 大文件（窗口只剩 1 MiB ≈ 889 行）断言 `CurrentModelState` 仍 ok 且取到尾部 `model_change` 的 `mydeepseek/kimi-k3`（`bytes<=3145728 PASS`）。

### ② 验证台已建（`scripts/verify/agent-card-model/verify.mjs`）

- 复制 `_template`，能力只从 `lib/`（cdp/launch/report/probes）拿；独立 profile `verify-agent-card-model` + 端口 9253/51814。
- **数据隔离**：fixture pi 会话写临时目录，`PI_CODING_AGENT_SESSION_DIR` + `WAVETERM_AI_SESSIONS_{INDEX,SQLITE_INDEX,META,DELETED_DIR}` 全指临时（不碰真实 ~/.pi 与真实索引）；fixture 用 pi v3 真实形状（4 个会话：switch 切模型无回复 / ai 标题 / user 标题 / mini 行）。
- 固定 12 条断言（与 PROGRESS TODO 第 2 条口径一一对应）：切模型无新回复→sub=kimi-k3 / provider·模型分两处（name=mydeepseek、sub=kimi-k3）/ raw titleSource 在 tooltip / 副标题无 First User Message / first_user_message 标记（comment-dots）/ ai ✨（wand-magic-sparkles）/ user 无标记 / mini 行零 RPC（patch LiveSessionState 间躲录 sessionId；mini 行从 meta 拆串且 LiveSessionState 从未叫过它的会话）/ modal 与 hover 四项逐项一致（name/sub/mark/raw tooltip）。
- titleSource 三态的种子方式（真实后端链）：ai 通过 `RpcApi.AgentCardSetCommand`（与 wsh `agent card set --title` 同链，marks ai），user 通过 `AISessionsService.Title`（SetTitle，marks user），first_user_message 自然来自文件 scanTitle。
- 台内额外补了两个环境修补：中文引导向导消除器（共享 `dismissOnboarding` 只认英文文案，“继续/下一步/开始使用”的 modal-backdrop 会盖住整页导致 hover 全灭）+ 启动期工作区稳定等待（`waitWorkspaceStable` + createBlock 返回 id 直等，避免块被布局初始化香掉）+ 单页面 renderer 校验（早期只有 0x0 空壳 shell 页，真实工作区在后续 renderer 上）。
- README area 表已登记（`agent-card-model` 行）。

### ③ 真机跑测（用户叫停：暂时不需要真机验证，未继续调平最后一项）

- 跑了多轮 launch+reset；最后一轮 **11/12 PASS**（report：`verify-runs/20261119T13155-agent-card-model/report.md`，commit 8eb023350），唯一失败：
  - `ai-title-sparkles-mark`：`AgentCardSet` 返回 `changed:true`（后端确认写入），但 hover 卡的 note-cache 读回的 summary 仍是 `first_user_message`（noteTitle 还是文件 scan 的 hello…）。待查方向：note-cache 30s TTL / Summary RPC refresh 参数 / agentdata 写链与 frontend 读链是否同 manager；用户写入链（`AISessionsService.Title`）同样路径却是 PASS，差异在写 API（SetAutoTitle vs SetTitle）。**下一步最可疑**：`AgentCardSetCommand` 的写路径里 `SetAgentCard` 是 fresh `NewManager("", nil)`，若 dev-isolated 环境下某一步 WAL/连接时序导致读链读到陈旧行，或 note-cache 在写前已被预置。**建议**：晚上维定时在 hover ai 前直接调一次 `AISessionsService.Summary({refresh:true})` 看后端是否已返回 ai；若返回 ai → 纯前端缓存问题；若仍 first_user_message → 写链问题。
- 其余 11 条全绿，含核心判据：切模型无新回复（sub=kimi-k3 不含 deepseek-v4.1-flash）、分两处、raw 在 tooltip、mini 行零 RPC（LiveSessionState 调用只含 verify-switch-1）。
- 台子提供 `--no-ledger` 选项（worker 迭代不落台账；默认跑法仍按规范落台账）。p95 基线未采（需要与 G2 基线比值，属 queue prove 阶段）。
- 环境坑：并行 agent 的未提交 `pkg/agentmcp/tools.go` WIP 中途出现 `ScopeRead` undefined 导致编译断续（等它自愈后重跑成功）；验证台跑测时避开了与其它 area 端口冲突。

### ④ 四条验收命令结果（全部机器实测，2026-11-19）

1. `go test ./pkg/aisessions/ ./pkg/service/aisessionsservice/ -run 'TestPiCurrentModelState|TestCodexCurrentModelState|TestLiveSessionStateCurrentModel|TestCurrentModelStateDoesNotLoadMessages|TestCurrentModelStateBudget|TestCurrentModelStateSkipsOversizedLine' -v`
   → 全 PASS（pi 2 子用例 + skipsOversized + budget[2000行/3.5MB] + codex 2 + live + does-not-load[load_calls=0]），**GO_OK**。
2. `npx vitest run frontend/app/view/term/ frontend/app/agent-status/ frontend/app/tab/`
   → **41 files / 448 tests 全过**（含本包 agent-identity 6 例、runtime-store TTL/复合键、title-source-mark 3 例）。VITEST_OK。
3. `npm run i18n:check` → **exit 1（预存漂移，非本包）**：4 条 allowlist 外 CJK 全部在 `emain/emain-wavesrv.ts`（11-19-wavesrv-oom 任务已提交的文案）；`check-parity` 单独跑 = 0 diff；本包改动的 term.json 双语 key 齐全（titleFromAI/titleFromFirstMessage）。本包白名单文件 0 新增硬编码。
4. `node scripts/check-tsc-baseline.mjs` → **55 > 基线 47（新增 8 条，全部非本包）**：全部来自其它在途任务已提交/未提交文件（emain-window、os-notify/agent-status-notify 测试、aipanel waveai-model、markdown.tsx、onboarding-starask、session-overview 测试、tabcontextmenu、preview mocks、processviewer preview、remark render 测试等）。本包白名单文件（agent-identity/agent-hover-card/agent-card-title-source-mark/agent-runtime-metadata-store/tab-more-agent-card/i18n term.json）**0 tsc error**。

> 结论：本包自身四条命令在白名单范围内全绿；仓库级 i18n / tsc 漂移分别属于 wavesrv-oom 与其它在途任务，需对应任务自己收（本 worker 红线内不能动它们）。

### 遗留给主 agent 的下一步

1. （可选）调平 `ai-title-sparkles-mark` 那一条：按上面“建议”二分定位（前端缓存 vs 后端写链），调平后重跑 `node scripts/verify/agent-card-model/verify.mjs` 期望 12/12 PASS。
2. `queue prove` 采数字 + G7 人验收（按 TODO 4-6 继续）。
3. 兄弟任务 `11-19-agent-card-title-source-marker` 状态同步（标记代码已随本包落地，仍是 TODO 7）。
4. 清理 `tmp/add-loop-1119.mjs` 等临时文件（TODO 8）。
