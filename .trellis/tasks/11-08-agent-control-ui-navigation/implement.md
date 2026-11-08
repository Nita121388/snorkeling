# 执行计划：Agent Control Surface P0.2

PRD：`prd.md`　设计：`design.md`

每个步骤都写成「命令 → 期望输出」，写不出期望输出的步骤不许进清单。

---

## 阶段 0：准备（不动代码）

- [ ] 0.1 建分支基线：`git log --oneline -1` → 确认在 `feat/agent-control-surface` 且含 `33af6458`
- [ ] 0.2 基线绿：`go build ./...` → exit 0
- [ ] 0.3 基线绿：`go test ./pkg/agentcontrol/... ./pkg/agentdata/...` → 全部 `ok`

**回滚点**：无（未改代码）

---

## 阶段 1：`wcore.ListBlocksScoped` 抽取（唯一动既有代码的步骤，先做）

- [ ] 1.1 新建 `pkg/wcore/blockscope.go`，把 `wshserver.BlocksListCommand` 的遍历逻辑原样搬入
- [ ] 1.2 `BlocksListCommand` 改为一行调用 `wcore.ListBlocksScoped`
- [ ] 1.3 新建 `pkg/wcore/blockscope_test.go`：同一 scope 下两者返回**逐字段相等**

验证：

```bash
go build ./...                                   # → exit 0
go test ./pkg/wcore/ -run TestListBlocksScoped   # → ok
go test ./pkg/wshrpc/...                         # → ok（既有 handler 回归）
```

**回滚点**：`git revert` 本阶段 commit（此时其他阶段还没开始，回滚干净）

---

## 阶段 2：DTO + interface（先定契约）

- [ ] 2.1 `pkg/wshrpc/wshrpctypes.go` 新增：`UIActiveRequest/Snapshot`、`UIStateRequest/Snapshot`、`BlockReadRequest/Result`、`BlockOpenRequest/Result`、`TabList/Create/Activate*`
- [ ] 2.2 interface 追加 8 个方法（`UIActiveCommand`、`UIStateCommand`、`BlockReadCommand`、`BlockOpenCommand`、`TabListCommand`、`TabCreateCommand`、`TabActivateCommand`）
- [ ] 2.3 `node scripts/run-task.mjs generate`

验证：

```bash
node scripts/run-task.mjs generate               # → 生成无报错
git diff --stat frontend/types/gotypes.d.ts      # → 只有新增行（无删除/改写既有类型）
go build ./...                                   # → exit 0
```

**回滚点**：`git checkout -- frontend/types/gotypes.d.ts pkg/wshrpc/wshclient/wshclient.go frontend/app/store/wshclientapi.ts`

---

## 阶段 3：`pkg/agentcontrol/ui.go`（纯逻辑，最好测）

- [ ] 3.1 `BuildUIActive(ctx, req)` → `UIActiveSnapshot`
- [ ] 3.2 `BuildUIState(ctx, req)` → `UIStateSnapshot`
- [ ] 3.3 `ReadBlock(ctx, req)` → `BlockReadResult`（按 view 分派）
- [ ] 3.4 `TruncatePayload`（行/字节双上限 + `truncated`）
- [ ] 3.5 `ui_test.go` + `testdata/ui_state.golden.json`

验证：

```bash
go test ./pkg/agentcontrol/ -run 'TestUI|TestReadBlock|TestTruncate'   # → ok
go test ./pkg/agentcontrol/...                                          # → ok（P0.0/P0.1 不回归）
```

**回滚点**：删 `ui.go`/`ui_test.go`/`testdata` 即可（阶段 2 的 DTO 可留）

---

## 阶段 4：`BlockOpen` 编排 + wshserver handlers

- [ ] 4.1 `pkg/wshrpc/wshserver/ui_commands.go`：3 个薄只读 handler（`UIActive`/`UIState`/`BlockRead`）
- [ ] 4.2 `pkg/wshrpc/wshserver/block_commands.go`：`BlockOpenCommand` 编排（tab 解析 → meta 白名单 → `CreateBlockCommand` → dedupe → wait → 富化）
- [ ] 4.3 `pkg/wshrpc/wshserver/tab_commands.go`：3 个 tab handler

验证：

```bash
go build ./...                                   # → exit 0
go test ./pkg/wshrpc/wshserver/...               # → ok
```

**回滚点**：删这三个文件

---

## 阶段 5：CLI

- [ ] 5.1 `cmd/wsh/cmd/wshcmd-ui.go`：`ui active` / `ui state`
- [ ] 5.2 `cmd/wsh/cmd/wshcmd-block.go`：`block read` / `block open`
- [ ] 5.3 `cmd/wsh/cmd/wshcmd-tab.go`：`tab list/create/activate`
- [ ] 5.4 `--split`/`--replace` 互斥校验；`--tail`/`--max-bytes` 上限钳制
- [ ] 5.5 CLI 单测：flag → `TargetAction` 映射表

验证：

```bash
go build -o /tmp/wsh-p02 ./cmd/wsh && /tmp/wsh-p02 ui --help      # → 列出 active/state
go test ./cmd/wsh/...                                              # → ok
```

**回滚点**：删三个 CLI 文件

---

## 阶段 6：真机验收（AC1–AC9）

前置：GUI 在跑，且**独立端口**避免抢主仓实例：

```bash
VERIFY_CDP_PORT=9241 VERIFY_PROFILE=verify-acs npm run dev:cdp
```

逐条：

| AC | 命令 | 期望 |
|---|---|---|
| AC1 | `wsh ui active --json`（agent 块内） | `self.blockId == $WAVETERM_BLOCKID`；`active.tabId == 后端 ActiveTabId` |
| AC2 | 在 tabB 的块内执行，用户切到 tabA | `self.tabId != active.tabId`，两者各自正确 |
| AC3 | `wsh ui state --json \| jq '.blocks\|length'` vs `wsh blocks list --json \| jq 'length'` | 两数相等 |
| AC4 | `wsh block read <term> --tail 20 --json` | `payload.lines\|length <= 20` 且 `bytes > 0` |
| AC5 | `wsh block read <preview> --json` | `payload.file == 块 meta file` |
| AC6 | `wsh block read <web块>`（本批 payload 无 error 但验证未知 view） | 未知 view → `payload.error == "unsupported view"`，exit 0 |
| AC7 | `wsh block open --view preview --file X --split right --wait --json` | 返回 `blockId`；CDP `document.querySelectorAll('.block')` 数量 +1 |
| AC8 | 同 AC7 再跑一次加 `--dedupe` | `deduped: true` 且 `blockId` 相同 |
| AC9 | `wsh tab create --name t --activate --wait --json` | 返回 `tabId`；DB 查 `activetabid == tabId` |

**回滚点**：无（只读/结构操作，不写用户数据）

---

## 阶段 7：收尾

- [ ] 7.1 全量回归：`go build ./...` + `go test ./pkg/agentcontrol/... ./pkg/agentdata/... ./pkg/wcore/... ./pkg/wshrpc/...`
- [ ] 7.2 AC10 回归：`wsh blocks list` / `wsh createblock` / `wsh session live` / `wsh agent card get` 输出与改动前一致
- [ ] 7.3 AC12：`git diff frontend/types/gotypes.d.ts` 只含新增
- [ ] 7.4 spec 更新：把「ACS 不得复制 objectservice 参数处理 / DB 写+事件发留在 wcore / meta 走白名单」写进 `.trellis/spec/snorkeling-docs/backend/agent-control-surface-contract.md`
- [ ] 7.5 `docs/project/agent-control-surface.md` 补 P0.2 章节（命令 + 验收剧本）
- [ ] 7.6 提交（一个 commit 或按阶段分；分支 `feat/agent-control-surface`）

---

## 依赖顺序（不能并行）

```
阶段1（wcore 抽取）─┐
阶段2（DTO）      ─┼─► 阶段3（agentcontrol 逻辑）─► 阶段4（handlers）─► 阶段5（CLI）─► 阶段6（真机）─► 阶段7
```

阶段 1 与阶段 2 可并行；其余严格串行（后者依赖前者产物）。

---

## 判据总表（写不出就说明这包不该进队列）

```bash
go build ./...                                   → 0
go test ./pkg/agentcontrol/...                   → ok
go test ./pkg/wcore/...                          → ok
go test ./pkg/wshrpc/...                         → ok
node scripts/run-task.mjs generate               → 无报错
git diff --stat frontend/types/gotypes.d.ts      → 无删除行
wsh ui active --json                             → self.blockId == $WAVETERM_BLOCKID
wsh ui state --json | jq '.blocks|length'        → == wsh blocks list 条数
wsh block read <term> --tail 20 --json           → .payload.lines|length <= 20
wsh block open ... --wait --json                 → .syncState == "layout-applied"
wsh tab create --activate --wait --json          → DB activetabid == 返回 tabId
```
