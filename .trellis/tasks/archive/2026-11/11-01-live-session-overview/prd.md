# 实时运行会话总览：`wsh session live/get/list/for-block`（只读）

## Goal

让 Agent 用一条命令掌握「此刻有哪些会话在跑、谁在跑、跑到哪一步、属于哪个会话卡、卡片 hash 是多少」。

## Requirements

- R1 `wsh session live [--include-idle] [--json]`：合并四处真相，输出 `LiveSessionRecord[]`（契约见设计文档 §7.6）。
  - `agentstatus.Get(blockId)`：state/phase/tool/message/prevState/activeSince/updatedAt/expiresAt/seq。
  - `chat.Manager`：GUI chat 的 state（starting/idle/running/closed）、lastUsed；`GetState()` 补 model/thinking/contextUsage/messageCount/isStreaming。
  - `aisessions` 摘要：sessionKey/title/titleSource/note/tags/props/hash。
  - `liveregistry`：未落盘的新会话也必须出现。
- R2 `wsh session get <sessionKey|sessionId|this> [--detail] [--json]`：单条记录；`this` 从 block 的 `agent:sessionid` / `agentstatus.SessionId` 解析。
- R3 `wsh session list [--source][--query][--tag][--project][--marked][--limit][--json]`：走现有 `ListOptions`，只读。
- R4 `wsh session for-block [<blockid|this>] [--json]`：block → session 的显式映射（调试与脚本用）。
- R5 降级：远程连接块 `card=null` + `warnings:["remote-summary-unavailable"]`；过期状态标 `freshness:"stale"`；单条失败不影响整批。
- R6 纯只读：不写 DB、不发 UI 事件、不改任何 frontend 文件。

## Acceptance Criteria

- [ ] 同时开「1 个 codex TUI + 1 个 pi GUI chat + 1 个空闲 agent block」时，`session live --json` 的行数/state/phase/title 与 UI 一致。（真机项，待 GUI 环境验收）
- [ ] kill 一个 agent 后，≤ 其 TTL 内该行变 `stale`（`--include-idle` 下仍可见），不静默消失。（freshness 语义已由 `TestIssueFreshness` 表驱动锁定；真机 kill 待验）
- [x] `session get this` 在 agent block 内可用；在非 agent block 内返回 `E_NOT_FOUND` 且说明原因。（`ResolveSessionForBlock` 无会话时返回 `E_NOT_FOUND` + hint，由 `TestResolveSessionIdentifierRequiresBlockForThis` 覆盖 usage 分支）
- [ ] `session live` 在 10 条会话下 P95 < 300ms（不含首次冷索引扫描）。（待真机基准）
- [x] 不触发无预算的全量扫描：并发调用 `session live` 不会重复扫描同一 index（遵守 scan contract）。
      已改为 `aisessions.Manager.ResolveSummaries`：live registry → 一次 SQLite 开库按主键批量 → 仅未知项限流升级。
      由 `TestResolveSummaries*` 4 个用例锁定。
- [x] `--json` 输出通过 golden 快照；字段缺失用 `null` 而非省略（除文档标注的 omitempty 字段）。
      `pkg/agentcontrol/testdata/session_live.golden.json` + `TestSessionLiveJSONNullSemantics`。

## Non-Goals

- 不做 `session wait`（P0.3）。
- 不做流式订阅 / watch（P2）。
- 不解析远程会话摘要（P2）。

## 实现备注

- 落地文件：`pkg/agentcontrol/{live,session,redact,errors}.go`、`pkg/aisessions/summaries_batch.go`、
  `pkg/aisessions/chat/manager.go`（`ActiveSessions`/`DefaultManager`）、
  `pkg/wshrpc/wshserver/session_commands.go`、`cmd/wsh/cmd/wshcmd-session.go`。
- `card.hash` 用 `agentdata.HashSession` 填，可直接作为 `agent card set --expected-hash`。
- 可发现性：`pkg/agentcap` 的 guide / external prompt 已宣传 `wsh session live|get`，有测试守住。
- 文档：`docs/project/agent-control-surface.md`。
- 剩余真机项（需要 GUI + 真实 agent 进程）：行数/状态与 UI 一致、kill 后 stale、10 条会话 P95。

## Notes

- 设计细节与字段语义见 `design/plans/agent-control-surface.md` §6.4、§7.6、§13 P0.0。
- 本任务不新增前端文件；唯一的前端相关点是 `chat.Manager` 的 Go 侧枚举。
