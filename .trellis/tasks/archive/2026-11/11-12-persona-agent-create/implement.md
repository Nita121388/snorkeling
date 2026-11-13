# A2.5 Agent 自创建 — 执行计划

> 判据见 `prd.md`，口径见 `design.md`（尤其 §2 propose 分流、§6 记忆纪律）。
> 每步带验证命令；出白名单即停。

## 1. pkg/persona（纯标准库，不进 RPC）

### Step 1.1 proposal 模型 + 闸门
- [x] `pkg/persona/proposal.go`：`Proposal` 结构（§4 JSON）、`Propose(opts)`、
      `ListProposals(root)`、`Approve(root, slug)`、`Reject(root, slug)`
- [x] `Create` 增加 `Agent *Provenance` 入口：非空 → 无 `--yes` 时写 proposal 不建目录；
      空（人类路径）行为零变化
- [x] 幂等：persona 已存在 → 复用返回不写 proposal；同 slug proposal 已存在 → 读回
- [x] 测试：分流矩阵（human dry-run / agent propose / agent --yes auto）、幂等两路
- [x] 验证：`go test ./pkg/persona/ -run TestPropose`

### Step 1.2 配额
- [x] `countProposalsToday(root, sessionID)`：扫 `.index/proposals/*.json`，
      `proposedAt` 当日（UTC）且 `proposedBy.sessionId` 相同 → ≥2 拒绝第三条（零写入、非 0）
- [x] 测试：2 过 3 拒、跨日重置、无 sessionId 不计数
- [x] 验证：`go test ./pkg/persona/ -run TestQuota`

### Step 1.3 memory add + 纪律
- [x] `pkg/persona/memory.go`：`AddMemory(root, id, section, text, agent, dryRun)`
      journal → 直接 append（时间戳行）；facts/lessons → inbox 结构化提议块，返回
      `RefusedDirectWrite` 错误（CLI 转退出码 1）
- [x] `createdBy.kind=human` 措辞更硬、行为同一
- [x] 测试：journal 直写 0 / facts 拒 1 且 inbox 含 text / 幂等追加格式
- [x] 验证：`go test ./pkg/persona/ -run TestMemory`

### Step 1.4 dormant
- [x] `WriteRoster`：last-active 代理 = max(journal mtime, createdAt)，>90 天行前缀 💤
- [x] 测试：新/旧 journal mtime 两态
- [x] 验证：`go test ./pkg/persona/ -run TestRoster`

## 2. CLI（cmd/wsh/cmd/wshcmd-persona.go）

- [x] `create`：`--from-session <key>|this`（`this` 走 RPC 解析，失败给明确错误）、
      `--agent-name`、`--charter-file`、`--memory-from-session`
- [x] `propose list` / `approve <slug> [--yes]` / `reject <slug> [--yes]` / `memory add`
- [x] 配额拒绝 → 退出码非 0 + stderr 报配额；memory facts/lessons → 退出码 1 + inbox 提示
- [x] 验证：`go build ./cmd/wsh/`

## 3. agentguide + skill 同步（AC5）

- [x] `pkg/agentguide/agentguide.go`：persona 5 条（list/get=observe；
      create/memory add/approve=data），含 flags/notes
- [x] 再生成 `pkg/agentskill/content/snorkeling-control/reference/commands.md`
      （= `agentguide.SkillMarkdown()` 输出落盘）
- [x] 验证：`go test ./pkg/agentguide ./pkg/agentskill ./pkg/agentcap`

## 4. 收尾

- [x] `go test ./pkg/persona/... ./pkg/agentguide/... ./pkg/agentskill/...` → ok
- [x] 全判据自校验可满足后跑 `queue prove --id F-1112-persona-agent-create`
- [x] 更新 `docs/project/persona-system.md`（A2.5 状态 + propose 分流口径）
- [x] spec：persona-store-contract.md 补「propose 分流 / 配额 / memory 纪律」三节
- [x] commit

## 回滚点

Step 1.x 各自独立（纯新增函数）；CLI 与 guide 两步独立 revert；
proposals/inbox/journal 是用户数据，回滚不删。

## touch 白名单（loop 工作项）

`pkg/persona/**`、`cmd/wsh/cmd/wshcmd-persona.go`、`pkg/agentguide/**`、
`pkg/agentskill/**`、`.trellis/tasks/11-12-persona-agent-create/**`、`.trellis/spec/**`、
`docs/project/persona-system.md`、`loop/**`
