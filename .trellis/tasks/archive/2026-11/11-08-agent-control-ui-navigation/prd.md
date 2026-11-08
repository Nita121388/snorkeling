# Agent Control Surface P0.2：UI 观察与导航

## Goal

P0.0（实时会话只读）与 P0.1（会话卡读写）已交付。本批补上 Agent 的第二组刚需：
**「我在哪 / 有什么 / 这个块里是什么 / 我要开什么」**。

一个本地 Agent 在 Block 内只用 `wsh` 就能：

```bash
wsh ui active --json                    # 用户在哪个 tab/block，我自己在哪
wsh ui state --json                     # 整体结构快照（窗口/工作区/tab/block）
wsh block read 2 --tail 80 --json       # 那个块里现在是什么
wsh block open --view preview --file /repo/README.md --split right --wait --json
wsh tab create --name "调研" --activate --json
```

完整设计：`design/plans/agent-control-surface.md` §6.1–6.3、§7.1–7.3、§13 P0.2。
父任务：`.trellis/tasks/11-01-agent-control-surface/`。

## 背景与依赖

| 依赖 | 状态 |
|---|---|
| P0.0 `wsh session live/get/list/for-block` | ✅ 已交付（`pkg/agentcontrol/{live,session,redact}.go`） |
| P0.1 `wsh agent card get/set` | ✅ 已交付（`pkg/agentcontrol/card.go`） |
| `agentdata` patch 管道（备份/审计/前置条件） | ✅ 已有 |
| `wcreateBlock` / `wcore.CreateTab` / `wcore.SetActiveTab` | ✅ 已有 |
| tab 路由 `getfocusedblockdata` | ✅ 已有 |

## Requirements

### R1 `wsh ui active`（只读，最高频）

返回两组必须分开的信息：

- `self`：调用者自己所在的 tab/block（来自 `WAVETERM_TABID` / `WAVETERM_BLOCKID`）。
- `active`：用户真正在看的 window/workspace/activeTab/focusedBlock。

两者不同正是 Agent 最需要知道的（「用户在别处看别的块」）。
输出 < 2 KB，供 Prompt / 循环体频繁调用。

### R2 `wsh ui state`（只读）

`wstore` 直读 window/workspace/tab/block + `blockcontroller` 运行态 + `agentstatus.Get`，
生成 `UIStateSnapshot` v1。本批只做后端直读，**不做 `--live`**（那是 P0.3）。

### R3 `wsh block read`（只读）

按 view 分派取内容，全部**有界**并带 `truncated` / `bytes`：

| view | payload |
|---|---|
| `term` | `lines[]`、`lineCount`、`lastCommand`、`agentStatus` |
| `preview` / `edit` | `file`、`content`、`language?`、`isDir?` |
| `web` | `url`、`title?` |
| `agent` | `sessionKey`、`summary`（不含正文） |
| 未知 | `error: "unsupported view"` + 仍返回 meta/运行态 |

**不新增后端 RPC**：复用 `termscrollback`、`fileshare`/文件读取、`GetMeta`、`aisessions` 摘要。

### R4 `wsh block open`（改 UI 结构，不写用户数据）

是既有 hidden `createblock` 的超集：`--view/--tab/--split/--replace/--magnified/--wait/--dedupe`。
**不重新实现创建逻辑**——内部调既有 `CreateBlockCommand`（已支持 `TargetAction=replace/split*`、`Magnified`、`Focused`、`SendUpdateEvents`）。

### R5 `wsh tab list/create/activate`（改 UI 结构）

3 个薄 RPC，内部调 `wcore.CreateTab` / `wcore.SetActiveTab`。`--wait` 轮询后端 `Workspace.ActiveTabId`。

### R6 安全边界（硬约束）

- 本批**只读 + 改 UI 结构**，`block close` / `tab close` **不在本批**（属 P1 destructive）。
- 所有 block meta 一律走既有 `agentcontrol.RedactMeta` 白名单，禁止整包透传（meta 可能含 `cmd:env` 等凭据）。
- 错误码沿用 `pkg/agentcontrol/errors.go` 的冻结集合，不新增。

### R7 `block read` 有界与扫描预算

- `--tail` 默认 80 行，硬上限；`--max-bytes` 默认 64 KiB。
- 禁止对每个 block 调 `aisessions.Manager.Summary`（违反 `aisessions-scan-contract.md`）：agent 块只取 live registry / 已有摘要。

## Acceptance Criteria

每条都必须能给出「命令 → 期望输出」。

- [ ] **AC1** `wsh ui active --json` 在 agent 块内调用，`self.blockId` == 该块的 `WAVETERM_BLOCKID`；`active.tabId` == 后端 `Workspace.ActiveTabId`。
- [ ] **AC2** 用户在 tabA 的 block1，Agent 在 tabB 的 block7：`self` 与 `active` 两组值不同，且分别正确。
- [ ] **AC3** `wsh ui state --json` 的 `.blocks | length` 与 `wsh blocks list --json` 的条数一致。
- [ ] **AC4** `wsh block read <term-block> --tail 20 --json` 返回 `payload.lines` 长度 ≤ 20，`bytes` > 0。
- [ ] **AC5** `wsh block read <preview-block> --json` 的 `payload.file` 与块 meta `file` 一致，`truncated` 在超限时为 `true`。
- [ ] **AC6** `wsh block read <未知view> --json` 返回 `payload.error == "unsupported view"` 且**不是**进程失败（exit 0 + 结构化错误）。
- [ ] **AC7** `wsh block open --view preview --file X --split right --wait --json` 返回 `blockId`，且 CDP 验证前端真的渲染出该块（`syncState` 推进到 `layout-applied`）。
- [ ] **AC8** `wsh block open --dedupe` 对同 `file` 第二次调用返回 `deduped: true` 且 `blockId` 相同。
- [ ] **AC9** `wsh tab create --activate --wait --json` 后 `Workspace.ActiveTabId` == 返回的 `tabId`（后端真相，非 FE 声称）。
- [ ] **AC10** 既有 `wsh blocks list` / `wsh createblock` / `wsh session *` / `wsh agent card *` 输出与行为不变（回归）。
- [ ] **AC11** `go build ./...` exit 0；`pkg/agentcontrol`、`pkg/wshrpc`、`pkg/wcore` 相关测试全绿。
- [ ] **AC12** `node scripts/run-task.mjs generate` 后 `frontend/types/gotypes.d.ts`、`frontend/app/store/wshclientapi.ts`、`pkg/wshrpc/wshclient/wshclient.go` 与 RPC 定义一致（无手改漂移）。

## Out of Scope（明确不做）

- `ui state --live`（tab 路由 `uistatelive`）→ P0.3
- `block close` / `tab close` / `block move` / `block copy` → P1（destructive / 需确认）
- `wsh agent guide` / capabilities 广告 → P0.3
- Common Text、外部 token/MCP → P1 / P1.5
- 任何前端 handler 新增：本批前端零改动（除 generate 产出的绑定文件）

## 约束

- 遵守 `.trellis/spec/snorkeling-docs/backend/aisessions-scan-contract.md`（禁止 N 个会话 = N 次扫描）。
- 复用优先：`CreateBlockCommand` / `wcore` / `agentstatus` / `agentdata` 已有能力不重写。
- 写进 spec：ACS 不得在 `wshserver` 复制 `objectservice` 的参数处理；「DB 写 + 事件发」必须留在 `wcore`。
