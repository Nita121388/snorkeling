# Agent 卡片模型与标题展示整改

## Goal

让 agent card 上的模型是会话**当前**真实模型且供应商可辨；标题来源只占一个小标记，不再用长串英文撑爆副标题。

## 现状证据（已核实，不在本任务重新论证）

- `agent:requestedmodel` 只在创建 block 时写入（`frontend/app/workspace/agent-launch.ts:1081`、`pkg/wshrpc/wshserver/agentlaunch.go:325`），运行时无写入方；`/model` 切换后卡片仍显示启动模型。
- 实时富化只有 `AgentHoverCard` 挂载时触发（`frontend/app/view/term/agent-hover-card.tsx:105`），store 无 TTL/失效（`frontend/app/agent-status/agent-runtime-metadata-store.ts:69`）；Tab 更多下拉的紧凑行完全不富化（`frontend/app/tab/tab-more-agent-card.tsx:117-119`）。
- 磁盘兜底取最后一条 assistant 消息的 Model（`pkg/service/aisessionsservice/chatcontrol.go:127-140`）；pi 的 `model_change` 只给缺 model 的消息兜底（`pkg/aisessions/provider_pi.go:345`），切模型后未产生新回复时拿不到新模型。
- `resp.modelProvider` 被写进 runtime store 但无 UI 消费（`agent-runtime-metadata-store.ts:83`）；`summary.Source`（`"pi"`）被当成模型供应商（`chatcontrol.go:128`）。真实 pi 会话 `sessions/--E--primary-heros-hero-feaa3f86--/2026-11-16T05-22-40-435Z_5ee32b88-1dce-490f-9346-274ba3c28c74.jsonl`：`model_change.provider=magpie`、`modelId=mydeepseek/deepseek-v4.1-flash`，74/74 条 assistant 消息都带 `provider=magpie, model=mydeepseek/deepseek-v4.1-flash`；`~/.pi/agent/models.json` 中 `deepseek` 的显示名为 `mydeepseek`。
- 标题来源用 `humanizeKey` 拼进卡片副标题（`agent-hover-card.tsx:184-186`），`first_user_message` → `First User Message`；`TitleSourceBadge` 已存在但只认 `ai`（`frontend/app/view/aisessions/title-source-badge.tsx:12`）。

## Task map

| 子任务 | 交付 | 复杂度 |
|---|---|---|
| `11-19-agent-card-model-provider` | 模型新鲜度 + 供应商拆分（Go service / 前端 identity + 三显示面） | complex：需 design.md + implement.md |
| `11-19-agent-card-title-source-marker` | agent card 标题来源短标记（前端展示层） | lightweight：PRD-only |

父任务不做实现，只负责跨子任务口径和最终集成验收。

## Cross-child Acceptance Criteria

- [ ] 同一条真实 pi 会话（上面的 session id）在 agent 悬浮卡 / 放大弹窗 / Tab 更多紧凑行上：供应商与模型分开可读，不再把 `mydeepseek/deepseek-v4.1-flash` 当成纯模型名塞在一行；原始完整串仍可在 tooltip / 复制里拿到。
- [ ] 会话中切换到新模型但没有新 assistant 回复时，重新打开卡片能拿到最新模型；不存在「挂着的卡片永远显示启动模型」。
- [ ] 悬浮卡副标题不再出现 `First User Message` / `Title source: first_user_message` 长串；`ai` 与 `first_user_message` 有小标记，完整说明在 tooltip（中英文 i18n）。
- [ ] 三面显示口径一致（拆分规则同源）：`AgentHoverCard`、`AgentCardModal`（复用悬浮卡）、`TabMoreAgentCard` 紧凑行；但只有悬浮卡/弹窗做异步富化，迷你行只拆串不发 RPC，避免菜单打开时 N 个请求。
- [ ] 新增验证 area `agent-card-model`（复制 `scripts/verify/_template/verify.mjs`，登记 `scripts/verify/README.md`，**由子任务 A 独占 area/README 写入权**，子任务 B 只新增断言），真机固定 12 条断言：`node scripts/verify/agent-card-model/verify.mjs` → 输出含 `12/12 PASS`。
- [ ] 性能红线（用户硬约束）：hover 首帧零新增同步工作；同一 block 5s 内 RPC 数 = 1（vitest 输出 `rpc_calls=1/1 PASS`）；后端当前模型路径只读 ≤1 MiB 尾部、≤2000 行、≤250ms，命中路径 `LoadMessages` 调用数 = 0（Go 测试输出 `load_calls=0/0 PASS`）；真机 20 次 hover 相对 G2 基线的 p95 比值由验证脚本打印 `perf_p95_ratio<=1.20 PASS`。
- [ ] 回归命令必须机器可判：`... && echo GO_OK` → 期望含 `GO_OK`；`npx vitest run ... && echo VITEST_OK` → 期望含 `VITEST_OK`；`npm run i18n:check && echo I18N_OK` → 期望含 `I18N_OK`。tsc 基线用 `node scripts/check-tsc-baseline.mjs` 输出 `<=47` 判定。
- [ ] 台账 `docs/project/verify-ledger.md` 一行结论，明细落 `verify-runs/`（gitignore）。

## Out of Scope

- 不改 `titleSource` 的取值、优先级、存储与后台自动生成规则（契约见 `.trellis/spec/snorkeling-docs/backend/aisessions-title-contract.md`）。
- 不改 `agent:requestedmodel` 的写入路径与模型目录单一事实来源（契约见 `agent-catalog-contract.md`），不新增静态模型表。
- 不改 AISessions 列表/详情属性区的完整标题来源标签，只改 agent card 副标题。
- 不做 GUI chat 的模型切换 UI；只消费已有 live state。
- 不引入新 npm/Go 依赖。

## 风险与流程约束

- loop 分类按引擎「首条命中」：两个子任务都新增 repro（验证台 + 测试），机械 `classify` 结果是 `bug` 而非 `arch`（`pkg/` 是第 4 条规则）。因此**一个 loop 包** `N-1119-agent-card-display`（type=bug、severity=S3、task 指向父任务）覆盖两个子任务，门链 G2 + G7，不需要 G1/G6 人签；不得把分类写成 arch 或让两个包抢同一个 verify area。
- Go 侧读取会话文件必须带时间/内存预算并复用现有 single-flight 约定，不得每次 hover 全量扫盘。
- 前后端拆分逻辑必须只有一处实现，避免多个消费方各自 `split("/")`。
