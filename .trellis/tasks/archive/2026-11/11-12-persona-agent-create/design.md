# A2.5 Agent 自创建 — 技术设计

> 设计总稿：`design/plans/persona-system.md` §4.5（四种场景 / 写入路径 / 批准闸门 / 防泛滥）
> PRD：`prd.md`。代码事实已核对（2026-11-12）。

## 0. 范围裁定（PRD 依赖注记）

PRD："`11-09-agent-block-create` 未落地前先只做 CLI。"

**做**：CLI 全量（propose 闸门 / 配额 / memory 纪律 / approve / agentguide 注册）。
**不做**：MCP `persona.create` / `persona.memory.add` 工具（等 11-09）；名册「⚡ 待批准」
UI（A4 的 Block 消费 proposals 列表；A2.5 只落 CLI 与数据格式）。

## 1. 代码事实

| 事实 | 位置 |
|---|---|
| A1 已有：`Create/Get/List/Rename`、dry-run 默认、幂等 | `pkg/persona/`（F-1112，verify green） |
| 外部能力表 + skill 同步契约：`agentguide.Commands()` ↔ `agentskill/content/snorkeling-control/reference/commands.md`（测试强校验） | `pkg/agentguide/agentguide.go`、`pkg/agentskill/agentskill_test.go:99` |
| `wsh agent guide --json` = `agentguide.JSON()` | `cmd/wsh/cmd/wshcmd-agent-guide.go` |
| `this` 会话解析需 RPC（`preRunSetupRpcClient` + `WAVETERM_BLOCKID`） | `cmd/wsh/cmd/wshcmd-agent-card.go` |

## 2. propose 闸门与 A1 契约的调和（关键决策 D1）

A1 契约：`create` 无 `--yes` = **dry-run 预览（零落盘）**。A2.5 PRD：`create` 无 `--yes`
= **写 proposal**。两者冲突（F-1112 判据 DRYRUN_NOWRITE_OK 已冻结）。

**裁定：按调用者身份分流，A1 契约不动。**

| 调用者证据 | 无 `--yes` 默认 | `--yes` |
|---|---|---|
| 人类 CLI（无 `--from-session` 且无 `--agent-name`） | dry-run 预览（A1 原样） | 直接落地，`createdBy.kind=human` |
| agent（`--from-session <key>\|this` 或 `--agent-name <n>`） | **写 proposal**（`.index/proposals/<slug>.json`），不建目录 | auto 落地，`createdBy.kind=agent` + 名册 ⚡ 徽标 |

理由：闸门防的是 agent 刷库，不是人预览自己要建什么；人走 dry-run 预览已经是更
强的默认。**此为对 PRD 字面的收窄，验收记录必须写明，签字人可推翻**（推翻则需
同时改 F-1112 的冻结判据）。

## 3. 命令面（CLI）

```
wsh persona create [--name …] [--emoji] [--role] [--provider] [--model]
                    [--from-session <key>|this]      # agent 身份 + 配额键
                    [--agent-name <n>]                # 无会话时自报 agent 身份
                    [--charter-file <p>] [--memory-from-session]
                    [--json] [--yes] [--root]
wsh persona propose list [--json] [--root]           # pending 提议
wsh persona approve <slug> [--yes] [--root]           # 人批准 → 落地，删 proposal
wsh persona reject  <slug> [--yes] [--root]           # 拒绝 → 删 proposal
wsh persona memory add <id> --section facts|lessons|journal --text "…"
                         [--from-session <key>|this] [--json] [--yes] [--root]
```

- `--from-session this` 走 RPC 解析（`agentcardget` 同款 `this` 路径）；RPC 不可用
  时报错退出（消息指明需 app 运行或用字面 key）
- `--memory-from-session` / `--charter-file`：只取文本做初稿（note/tags 走
  `AgentCardGetCommand`），不复制会话身份

## 4. proposal 文件（`.index/proposals/<slug>.json`）

```json
{
  "schemaVersion": 1,
  "kind": "persona.proposal",
  "slug": "backup-guard",
  "proposedAt": "RFC3339",
  "proposedBy": {"kind": "agent", "name": "pi", "sessionId": "…"},
  "options": {"name": "…", "emoji": "…", "role": "…", "provider": "…", "model": "…"},
  "status": "pending"
}
```

- 幂等：同名 persona 目录已存在 → 复用返回（A1 语义），**不写 proposal**
- 同 slug proposal 已存在 → 读回返回（幂等，不覆盖）
- `approve`：按 options 落地 scaffold（`createdBy` 保留 agent + 加
  `approvedBy:{kind:"human",ts}`），删 proposal，重扫名册；`--yes` 必须显式（人手敲）
- `reject`：删 proposal，留一行到 journal（不动人设）

## 5. 配额（防泛滥）

- 键 = `proposedBy.sessionId`；窗口 = 自然日（UTC，proposedAt）
- 上限 2：第 3 次 propose → 退出码非 0、**零写入**，stderr 报「配额」
- 无会话上下文（纯 `--agent-name`）：不计数（诚实降级：无法归属就不管，但
  `createdBy` 有据可查）
- 数据源即 proposal 文件本身（扫描计数），无独立状态文件、无漂移

## 6. 记忆纪律（memory add）

| section | 行为 | 退出码 |
|---|---|---|
| journal | 直接 append（带时间戳行 + 出处） | 0 |
| facts / lessons | **恒走 inbox**：结构化提议块（source/section/text）追加到 `MEMORY/inbox.md` | 1（拒绝直写） |

- 与 `createdBy.kind` 无关：memory 是长期资产，agent 永远只能提议（设计 §4.5）
- `createdBy.kind=human` 的人设：措辞更硬（「人写的档案，只能提议」），行为同一
- `--yes` 对 facts/lessons 无效（这正是闸门本身）；对 journal 是写权限确认

## 7. dormant（90 天）

- last-active 代理 = max(`journal.md` mtime, `persona.json.createdAt`)；登场史
  （props.persona）等 A1.5 接上后并入
- `WriteRoster` 输出：超 90 天的人设行前缀 💤（名册 L0 便宜可读）

## 8. agentguide 注册（AC5）

| cmd | scope |
|---|---|
| `persona list` / `persona get` | observe |
| `persona create` / `persona memory add` / `persona approve` | data |

- 同步再生成 `agentskill/content/snorkeling-control/reference/commands.md`
  （`agentguide.SkillMarkdown()` 输出直接落盘，测试强制一致）
- `agentscope.commandScopes` **不动**（那是 RPC 传输层的门；CLI 不经过它——
  假门不做，同 A1 的 §7 口径）

## 9. 兼容与回滚

- `create` 人类路径行为零变化（F-1112 判据仍绿）；新增子命令纯增量
- 回滚 = revert 单 commit；proposals 目录是用户数据，回滚不删

## 10. 开放决策（留给签字人）

| # | 决策 | 建议 |
|---|---|---|
| D1 | propose 默认按调用者身份分流（§2） | 建议（保 A1 冻结判据） |
| D2 | 配额只对有会话上下文的 propose 生效 | 建议（诚实降级优于假归属） |
| D3 | `reject` 是否写 journal 留痕 | 建议写（一行） |
