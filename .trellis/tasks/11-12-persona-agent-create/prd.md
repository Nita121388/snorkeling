> **Confirmed: 2026-11-12 @nita**

# A2.5 Agent 自创建：CLI + MCP + proposals 闸门

## Goal

agent 自己提议/创建人设（升格自己、派生同事），默认不落盘、不可刷爆、不可改人的东西。

## Requirements

- CLI：`wsh persona create --from-session this|--name …`、`wsh persona memory add <id> --section facts|lessons`、`list/get`
- MCP 工具：`persona.create` / `persona.memory.add`（agentmcp 门面，`data` scope）
- 闸门：默认 **propose** → `.index/proposals/<slug>.json`，名册「⚡ 待批准」；`--yes` 才 auto 落地
- 防泛滥：slug 幂等复用；单会话每日配额 2；90 天未登场 → dormant（不删除）；`createdBy.kind=human` 只能被提议不可改删；人编辑后升格 human
- provenance：`createdBy{kind,name,sessionId,ts}` + `origin{deviceId,deviceName,platform}`
- 记忆纪律：journal 直写；facts/lessons/CHARTER 只能写 `MEMORY/inbox.md`

## Acceptance Criteria

- [ ] `go test ./pkg/persona/...` → ok（配额/幂等/人工优先用例）
- [ ] `wsh persona create --name X`（无 --yes）→ proposal 文件存在且目录不落盘
- [ ] 同会话第 3 次 propose → 非 0 退出且报配额
- [ ] 对 human 人设 `memory add --section lessons --yes` → 拒绝且写入 inbox
- [ ] `wsh agent guide --json` 中 persona 命令 `>= 3` 条（能力表可发现）

## 依赖

A1；`11-09-agent-block-create` 未落地前先只做 CLI。
