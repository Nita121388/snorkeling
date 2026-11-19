# 模型展示新鲜度与供应商拆分

## Goal

agent card 显示会话**当前**模型（切模型后无需新回复也能更新），并把 `provider/model` 拆成供应商与模型分别展示，原始完整串不丢。

## Background / 确认事实

| 缺陷 | 证据（file:line） |
|---|---|
| 启动模型写死在 block meta | `frontend/app/workspace/agent-launch.ts:1081`；`pkg/wshrpc/wshserver/agentlaunch.go:325`；运行时无其他写入方 |
| 只有悬浮卡富化，Tab 迷你行不富化 | `frontend/app/view/term/agent-hover-card.tsx:105`；`frontend/app/tab/tab-more-agent-card.tsx:117-119` |
| 富化缓存无 TTL / 无失效 | `frontend/app/agent-status/agent-runtime-metadata-store.ts:69-113` |
| 磁盘兜底拿最后一条 assistant 消息 | `pkg/service/aisessionsservice/chatcontrol.go:127-140` |
| pi 的 `model_change` 只做缺-model 兜底 | `pkg/aisessions/provider_pi.go:323-350` |
| modelProvider 字段无 UI 消费，且被写成 source | `agent-runtime-metadata-store.ts:83`；`chatcontrol.go:128` |
| 真实数据 | `~/.pi/agent/sessions/--E--primary-heros-hero-feaa3f86--/2026-11-16T05-22-40-435Z_5ee32b88-1dce-490f-9346-274ba3c28c74.jsonl`：`model_change.provider=magpie`，`modelId=mydeepseek/deepseek-v4.1-flash`；74/74 条 assistant 消息 `provider=magpie, model=mydeepseek/deepseek-v4.1-flash`；`~/.pi/agent/models.json` 中 provider `deepseek` 的 name=`mydeepseek` |

## Requirements

- **R1（新鲜度）**：`AgentHoverCard` 与复用它的 `AgentCardModal` 在打开/挂载时取当前会话模型；pi 会话最新 `model_change` 优先于最后一条 assistant 消息，因此「切了模型但没有新回复」也能显示新模型。**明确限制**：Tab 迷你行只拆启动串、不做异步富化，不会独立刷新（性能取舍，见 R5）。
- **R2（拆分）**：模型串含 `/` 时第一段作供应商、其余作模型（只拆第一个 `/`）；不含 `/` 时用会话显式 provider 字段。agent 类型词（`pi`/`codex`/`opencode`/`claude`/`Agent`）不算模型供应商。cc-switch vendor 名不参与本判定，vendor 仍由既有 `resolveAgentVendorName` 负责。
- **R3（真实 provider）**：`LiveSessionState` 的 `modelProvider` 返回会话级 supplier：pi 取活跃分支的 `model_change.provider` / `message.provider`；codex 取 `session_meta.payload.model_provider`（已在本机真实 rollout 验证：`model_provider="custom"` 位于 session_meta，不在 turn_context），模型仍取最后 `turn_context.payload.model`；不再固定写 `summary.Source`。
- **R4（刷新策略）**：首帧只读同步 block meta；异步拉取按 `blockId|sessionId|source` 复合键去重 + 5s TTL；**只有成功解析出 model 才盖 `loadedAt`**，失败/无结果只记 `lastAttemptAt` 并保留旧值；禁止任何定时器轮询。同一复合键 5s 内最多 1 次 RPC；键变化（换会话/换 provider）立即作失效处理。长开的 modal 不自动刷新，刷新发生在下次打开/挂载。
- **R5（性能红线，用户硬约束）**：当前模型命中路径为有界尾部读（≤1 MiB / ≤2000 行 / ≤250ms，只解析完整行，丢弃窗口起点那半行；用 `ReadBytes('\n')` 逐行读并跳过超长行，禁止用 1 MiB token 上限的 `bufio.Scanner`），命中后不再调用 `manager.Load`；活动分支必须按 `id/parentId` 从文件最后一条回溯，不能盲取文件里最后一条 `model_change`。Tab 迷你行零 RPC。
- **R6（兼容）**：显示优先级 `vendorName || identity.provider || sessionProvider || providerLabel`；model 文本用共享 `formatAgentModel(identity, displayProvider)`（与 displayProvider 相同的前缀不重复展示）。raw 规范为 `modelId || modelName`，完整串进 tooltip。`resolveAgentModel` 的 live > requested > session 优先级不变。

## Acceptance Criteria

- [ ] Go 新测试至少 6 个：`TestPiCurrentModelState`（含活跃分支反例）、`TestCodexCurrentModelState`（session_meta provider）、`TestLiveSessionStateCurrentModel`、`TestCurrentModelStateDoesNotLoadMessages`（`load_calls=0/0 PASS`）、`TestCurrentModelStateBudget`（`bytes<=1048576 PASS`、`lines<=2000 PASS`）、`TestCurrentModelStateSkipsOversizedLine`（>1 MiB 行后仍有 `model_change`）。命令尾部 `&& echo GO_OK` → 期望含 `GO_OK`。
- [ ] 真实数据校验：上面的 pi session 输出 `currentModel=mydeepseek/deepseek-v4.1-flash`、`currentProvider=magpie`、`assistantWithModel=74/74`；拆分为 `provider=mydeepseek / model=deepseek-v4.1-flash`；另取一条含 `model_provider="custom"` 的真实 codex rollout 验证 provider 非空。
- [ ] 前端单测：拆分用例 6/6 PASS（带斜杠 / 多斜杠 / 无斜杠 + provider / provider=pi 负例 / 空串 / 纯空白）；TTL 用例 `rpc_calls=1/1 PASS`（10 次挂载）；失败分支不盖 loadedAt 的用例输出 `failure_not_cached PASS`。命令尾部 `&& echo VITEST_OK` → 期望含 `VITEST_OK`。
- [ ] 真机 `node scripts/verify/agent-card-model/verify.mjs` → 输出含 `12/12 PASS`（切模型无新回复→卡片更新、provider 与模型分两处、raw 在 tooltip、副标题无长串），并打印 `perf_p95_ratio<=1.20 PASS`（与 G2 基线比值，基线落 `verify-runs/`）。
- [ ] 回归：`go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/... && echo GO_OK`、`npx vitest run && echo VITEST_OK`、`npm run i18n:check && echo I18N_OK`、`node scripts/check-tsc-baseline.mjs` 输出 `<=47`。

## Out of Scope

- 不改 `agent:requestedmodel` 的写入路径、模型目录与启动器参数（单一事实来源契约）。
- 不把 provider 拆出的值写回任何 meta / DB（纯展示派生）。
- 不改标题来源标记（由兄弟任务 `11-19-agent-card-title-source-marker` 负责）。
- 不实现 GUI chat 的模型切换 UI，也不新增 wps 事件；`LiveSessionState` 仍是拉取式。
- 不新增 Go/npm 依赖。

## Open Questions

无阻塞问题。展示口径采用用户给定示例：带斜杠时第一段即供应商（`mydeepseek`），余段为模型；无斜杠时退回会话 provider 字段，完整串放 tooltip。
