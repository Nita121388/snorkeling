# 会话 agent card 读写：note / tags / title / props

## Goal

让 Agent 读取并编写「会话卡」信息，且**绝不覆盖用户手写内容**。所有写入复用 `agentdata` patch 通道
（`--dry-run` / `--yes` / 备份 / 审计 / `expectedHash` 前置条件）。

## Requirements

- R1 `wsh agent card get <sessionKey|sessionId|this> [--json]`
  返回 `{summary:{title,titleSource,note,tags,props}, persona:null, hash, updatedAt}`。
- R2 `wsh agent card set <...> --note <s|@file> --tags-set|--tags-add|--tags-remove ...`
  → 复用现有 `session_note.update` op；真实 apply 必须带 `expectedHash`。
- R3 `--title <t>` → 新 op `session_title.update`：
  - 写入 `titleSource="ai"`；
  - 现有 `titleSource=="user"` 且无 `--force` → `E_CONFLICT`；
  - `--force` 才覆盖。
- R4 `--prop k=v`（可重复）/ `--prop-json <json|@file>` → 新 op `session_prop.update`：
  - 内置键（note/tags/starred/title_source）拒绝；
  - 沿用 `ApplyAIProperties` 的安全契约：拒非法类型/值、`source=user` 默认跳过、`--force` 覆盖；
  - 返回值回报 `skipped[]` 与原因。
- R5 单次调用里 note/tags/title/props 混用 → **一个 patch、多条 operation**；任一前置条件失败则整体不写。
- R6 `--dry-run` 打印字段级 before/after；`--yes` 执行；无 `--yes` 时默认 dry-run 并提示。
- R7 写完成后 UI 会话卡即时刷新（`aisessions:noteupdated` / summary 事件已有，不新增事件）。

## Acceptance Criteria

- [x] `card get this` 返回的 `hash` 可直接用于 `card set ... --yes`。（`TestAgentCardEndToEnd`）
- [x] `tags.add` 重复执行不产生重复标签；`tags.set []` 清空。（复用既有 `session_note.update` + `TagPatch` 语义，`TestTagPatchSetEmptyClearsTags`）
- [x] `titleSource=="user"` 时 `--title` 返回 `E_CONFLICT`，`--force` 才成功且标记为 `ai`。
      （`TestSessionTitleUpdateProtectsUserTitle` / `TestAgentCardEndToEndProtectsUserTitle` / `...ForceOverwritesUserTitle`）
- [x] `source=user` 的 prop 默认跳过并出现在 `skipped[]`；`--force` 才覆盖。（`TestSessionPropUpdateSkipsUserValueUnlessForced` / `...ForceOverwritesUserValue`）
- [x] 并发手改后（hash 变化）apply 被 `E_CONFLICT` 拦住，不产生部分写入。（`TestAgentCardEndToEndRejectsStaleHash`）
- [x] 每次真实 apply 有 SQLite 备份 + `patch-audit.jsonl` 记录。（`TestAgentCardEndToEnd` 断言 `BackupIds` 非空；审计复用既有 `ApplyPatch` 路径）
- [x] `go test ./pkg/agentdata/... ./pkg/aisessions/...` 全绿；新增 op 的 schema/示例/guide 同步。
      （`TestSchemaCoversSessionControlOps` / `TestExamplesCoverSessionControlOps` / `TestAgentCardCommandsAreDiscoverable`）

## Non-Goals

- 不做 persona/avatar 写入（仅前端 localStorage，见设计文档 §15 D3）。
- 不做自动生成（AutoGenerate 已有，不重复）。
- 不做远程连接会话的卡片写入（v1 仅本地）。

## 实现备注

- `pkg/aisessions`：`TitleSourceUser`/`TitleSourceAI` 常量、`ErrTitleProtected`、`SetAITitle(ctx, id, title, force)`。
- `pkg/agentdata`：`session_title.update` / `session_prop.update` 两个 op，走既有 validate/preview/apply 管线；
  `OperationReport` 增加 `skipped[]`。
- `pkg/agentcontrol/card.go`：`GetAgentCard` / `SetAgentCard`；CLI flag → 单个 `agentdata.Patch`。
- `cmd/wsh/cmd/wshcmd-agent-card.go`：`get`/`set`，含字段级 diff 与 `skipped` 呈现。
- 新 RPC：`AgentCardGetCommand` / `AgentCardSetCommand`；wire DTO 手写（agentdata 反向依赖 wshrpc，不能直接引用其类型）。
- **修掉既有缺陷**：多 op patch 无法生效 —— `applyOperation` 会用同一 patch 内前序 op 已改过的状态重新校验
  `expectedHash`，必然冲突并触发备份回滚撤掉刚写的数据。已改为只在写前统一校验一次前置条件。
- 已知未做（Non-Goals 内）：persona/avatar 后端化（仅前端 localStorage，设计 §15 D3）。

## Notes

- 设计：`design/plans/agent-control-surface.md` §6.5、§13 P0.1、§10.5.3（写安全）。
- 必须遵守 `.trellis/spec/snorkeling-docs/backend/aisessions-title-contract.md` 的 titleSource 优先级与合并规则。
