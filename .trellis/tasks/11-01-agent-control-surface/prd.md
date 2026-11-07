# Agent Control Surface：本地 Agent 操作 Snorkeling 的控制面

## Goal

让本地 Agent（pi / codex / claude-code / opencode）通过 `wsh` 受控地读取实时会话、编写会话 agent card、
观察/导航 UI、操作 Common Text，并为 App 外 Agent 提供 scoped token + MCP 门面。

完整设计：`design/plans/agent-control-surface.md`。

## 子任务地图

| 序 | 子任务 | 状态 | 交付 |
|---|---|---|---|
| 1 | `11-01-live-session-overview` | P0 ✅ 已交付 | `wsh session live/get/list/for-block`（只读） |
| 2 | `11-01-session-agent-card` | P0 ✅ 已交付 | `wsh agent card get/set`（note/tags/title/props） |
| 3 | 待建（P0.2） | — | `wsh ui active/state`、`block read/open`、`tab` |
| 4 | 待建（P0.3） | — | `ui state --live`、`session list` 筛选、`agent guide` |
| 5 | 待建（P1） | — | Common Text、agent 启动、destructive 开关 |
| 6 | 待建（P1.5） | — | 外部 token → MCP → skill |

## 跨子任务验收

- [x] 两个 P0 子任务合入后，Agent 可在任意 Block 内只用 `wsh` 完成：
      「发现正在跑的会话 → 读状态 → 读/写该会话卡片」。
      验收剧本见 `docs/project/agent-control-surface.md` §"Cross-surface acceptance script"。
- [x] 所有写操作走 `agentdata` patch（备份 + 审计 + 前置条件），无第二套写路径。
      `agent card set` 只做 flag → `agentdata.Patch` 翻译，随后调用 `agentdata.ApplyPatch`。
- [x] `wsh` 既有命令（`blocks list` / `createblock` / `data apply` / `agentstatus`）输出与行为不变。
      `pkg/agentdata` / `pkg/wshrpc` / `cmd/wsh/cmd` 既有测试全绿。
- [x] 新增配置项全部落 `schema/settings.json` + `pkg/wconfig`，并有默认值。
      （本批两个 P0 未新增任何配置项，`task generate` 对 schema/settings.json 无 diff）

## 交付状态（2026-11 批次）

- P0.0 只读会话面：已完成，含扫描契约修复、golden 快照、24 个合并算法单测、agentcap 可发现性。
- P0.1 会话卡读写：已完成，含 2 个新 patch op、10 个 op 单测、5 个端到端用例、user 内容保护。
- 未完成（设计 §13 后续批次）：P0.2 `ui`/`block open`/`tab`、P0.3 观察面完善、P1 Common Text、
  P1.5 外部 token/MCP。
- 剩余真机项（需 GUI + 真实 agent 进程）：`session live` 行数/状态与 UI 一致、kill 后 stale、P95 基准。

## 约束

- 不新增网络监听面；外部接入只在 P1.5 按设计文档 §10.5 实施。
- 复用优先：`CreateBlockCommand`、`agentdata`、`agentstatus`、`aisessions.Manager` 已有能力不重写。
- 遵守 `.trellis/spec/snorkeling-docs/backend/aisessions-*.md` 的既有契约（尤其标题与扫描预算）。
