# Implement — 模型展示新鲜度与供应商拆分

## 步骤 0：loop 工作项与门（动手前）

1. 只建**一个** loop 包：`id=N-1119-agent-card-display`、`type=bug`、`severity=S3`、`task=11-19-agent-card-model-title-display`（父任务），`title` 覆盖模型与标题两半。引擎首条命中 repro → `bug`（不是 arch，pkg/ 是第 4 条规则）：
   `node E:/primary/projects/loop/bin/loop.mjs queue add --json '{"id":"N-1119-agent-card-display","type":"bug","priority":"P1","severity":"S3","task":"11-19-agent-card-model-title-display","title":"...","accept":[...],"touch":[...],"budget":{"minutes":120,"retries":2}}'`；payload 必须含 id/type/accept（含 cmd+expect）/touch/budget。
2. `touch` 白名单（两子任务并集，避免 out-of-scope park）：`pkg/aisessions/{types,manager,provider_pi,provider_codex,provider_pi_test,provider_codex_test}.go`、`pkg/service/aisessionsservice/{chatcontrol,chatcontrol_test}.go`、`frontend/app/view/term/{agent-identity,agent-identity.test,agent-hover-card,agent-card-title-source-mark,agent-card-title-source-mark.test}.ts(x)`、`frontend/app/agent-status/{agent-runtime-metadata-store,agent-runtime-metadata-store.test}.ts`、`frontend/app/tab/{tab-more-agent-card,tab-more-agent-card.test}.tsx`、`frontend/i18n/locales/{zh,en}/term.json`、`scripts/verify/agent-card-model/**`、`scripts/verify/README.md`、`docs/project/verify-ledger.md`、`loop/red/N-1119-agent-card-display.txt`（G2 红证产物）、本父任务及两个子任务目录。
3. 门链 G2 + G7（bug 无 G1/G6）；**area/README 写入权归本任务**，兄弟任务只追加断言。G2 红证先落（见步骤 1），并把 20 次 hover 的 p95 基线写进 `verify-runs/`。
4. `queue add` 后不要跑 `queue classify` 覆盖类型；需要确认时用 `queue show --id N-1119-agent-card-display`。

## 步骤 1：红证（G2，必须先于修复）

- 新写 `TestPiCurrentModelState`：真实形状 fixture（`model_change` 在最后一条 assistant 之后）+ 同文件废弃分支反例，当前代码拿不到新模型 → RED；输出存 `loop/red/N-1119-agent-card-display.txt`。
- 新写 `TestLiveSessionStateCurrentModel`：断言 `modelProvider != "pi"` → RED。
- 前端 `agent-identity.test.ts` 的 `mydeepseek/deepseek-v4.1-flash` 拆分用例：当前没有 `resolveAgentModelIdentity` → 编译/断言 RED。
- 真机 `scripts/verify/agent-card-model/verify.mjs` 先跑一次红证（切模型无新回复 → 卡片仍显示旧模型），并采集 20 次 hover p95 基线落 `verify-runs/`。
- 每个 expect 都写成机器可判 sentinel：`GO_OK` / `VITEST_OK` / `I18N_OK` / `12/12 PASS` / `perf_p95_ratio<=1.20 PASS`；不写 `>=N`、`FAIL=0`、`全部 PASS`。

## 步骤 2：Go 侧

1. `pkg/aisessions/types.go`：加 `ModelState` + 可选 `ModelStateProvider`；`Manager.CurrentModelState(ctx, key)` 写在同文件（白名单里的 manager.go 只是保险）。按 `summary.Source` 找 provider。
2. `pkg/aisessions/provider_pi.go`：`ReadBytes('\n')` 有界尾部读（1 MiB / 2000 行 / 250ms），丢窗口起点残行，超长行跳过但继续读；窗口内按 `id/parentId` 回溯活跃 leaf 链，只认链上的 `model_change` / assistant model；`ok = Model != ""`。
3. `pkg/aisessions/provider_codex.go`：尾部取最后 `turn_context.payload.model`；provider 取 `session_meta.payload.model_provider`（真实数据确认），回落最后消息。
4. `pkg/service/aisessionsservice/chatcontrol.go`：磁盘兜底改为 live state → CurrentModelState（**命中即返回，禁止继续 `manager.Load`**）→ 未命中才原最后消息；不再把 `summary.Source` 写进 `ModelProvider`。
5. 性能护栏测试：`TestCurrentModelStateDoesNotLoadMessages` 输出 `load_calls=0/0 PASS`；`TestCurrentModelStateBudget` 输出 `bytes<=1048576 PASS` / `lines<=2000 PASS`；`TestCurrentModelStateSkipsOversizedLine` 断言 >1 MiB 行后的 `model_change` 仍被识别。
6. 跑：`powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/ ./pkg/service/aisessionsservice/ -run 'TestPiCurrentModelState|TestCodexCurrentModelState|TestLiveSessionStateCurrentModel|TestCurrentModelStateDoesNotLoadMessages|TestCurrentModelStateBudget|TestCurrentModelStateSkipsOversizedLine' -v && echo GO_OK"` → 期望含 `GO_OK`。
7. 真实数据校验（临时脚本放 `tmp/`，跑完删）：解析 PRD 中的 session id，输出 `currentModel` / `currentProvider` / `assistantWithModel=74/74`。

## 步骤 3：前端

1. `agent-identity.ts` 加 `resolveAgentModelIdentity` 与 `formatAgentModel` 两个纯函数，确保唯一 split/去重入口；补 6 条单测。
2. `agent-runtime-metadata-store.ts`：复合键 `blockId|sessionId|source`；成功才盖 `loadedAt`，失败只记 `lastAttemptAt`；raw 改 `modelId || modelName`；刷新期间保留旧值。
3. `agent-hover-card.tsx` 消费 identity + `formatAgentModel`，tooltip 保留 canonical raw；不改 `resolveAgentModel` 优先级。
4. `tab-more-agent-card.tsx` 的 mini 行**只做纯拆串，不调用 `ensure`**，但复用 `formatAgentModel`；新增 store 单测输出 `rpc_calls=1/1 PASS`（10 次挂载）与 `failure_not_cached PASS`。
5. 跑 `npx vitest run frontend/app/view/term/ frontend/app/agent-status/ frontend/app/tab/ && echo VITEST_OK` → 期望含 `VITEST_OK`。

## 步骤 4：真机验证（收尾必做）

1. 从 `scripts/verify/_template/verify.mjs` 复制新 area `agent-card-model`；能力只用 `scripts/verify/lib/`（`cdp`/`launch`/`probes`/`report`/`pixel`），不写第二份 CDP client。
2. 登记 `scripts/verify/README.md` area 表（本任务独占写权，兄弟任务只追加断言）；固定 12 条断言：切模型无新回复→卡片更新、provider 与模型分两处、raw 串在 tooltip、副标题无 `First User Message` 长串及其余 8 条。
3. `node scripts/verify/agent-card-model/verify.mjs` → 退出码 0/1/2，输出含 `12/12 PASS` 与 `perf_p95_ratio<=1.20 PASS`（与 `verify-runs/` 里的 G2 基线比值）；台账 `docs/project/verify-ledger.md` 写一行结论。
4. 回归：`npx vitest run && echo VITEST_OK`、`npm run i18n:check && echo I18N_OK`、`node scripts/check-tsc-baseline.mjs` 输出 `<=47`。

## 步骤 5：合规与收尾

- G5 机器判据：无新依赖、无硬编码模型表、i18n key 双语齐全。
- `node E:/primary/projects/loop/bin/loop.mjs queue prove --id N-1119-agent-card-display --root .` 采数字；G7 人验收后再 `accept --solution fixed`/`release`（bug 类必须先给 solution）。
- 提交前跑 `detect_changes`（GitNexus MCP 可用时）确认影响面只在白名单。

## 回滚点

- 每个步骤结束一个可回滚点；整体单 commit，`git revert <sha>` 即可。
- 无 meta/DB 迁移；若真机发现 provider 误判，可先把 `resolveAgentModelIdentity` 的 provider 分支关掉（保留 TTL 与 Go 侧），不影响旧展示。
