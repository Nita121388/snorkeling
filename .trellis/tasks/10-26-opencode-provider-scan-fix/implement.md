# 执行计划：OpenCode Provider 扫不到会话（schema 漂移修复）

> 状态：planning（未开始实施）。`task.py start` 后才进入 Phase 2。

## 前置

```powershell
# 工具链（Windows）
npm run setup
. .\scripts\use-local-env.ps1 -Quiet

# 基线
git status --short
PYTHONIOENCODING=utf-8 python -m pytest --version  # (go 测试用 go test)
go test ./pkg/aisessions -run OpenCode    # 预期：当前无 opencode 相关测试，或现有测试全绿
```

**重要**：工作区已有未提交改动（annotation 等）。本任务改动必须与它们**分开 commit**。
建议在 `implement.jsonl` 标注，并在每步 `git diff --stat` 检查。

## M1 DB 路径探测（R1）

- [ ] 1.1 `pkg/aisessions/paths.go`：新增 `openCodeDBCandidates()`，按 R1 顺序返回候选路径。
- [ ] 1.2 改写 `DefaultOpenCodeDBPath` 为"遍历候选、返回第一个存在的文件"，保留 `OPENCODE_DB` 优先。
- [ ] 1.3 `DefaultProviders` gating 不变（仍按存在性注册），确认路径命中后注册发生。
- [ ] 1.4 单测 `TestOpenCodePathCandidates`：
      - 设 `OPENCODE_DB` → 优先返回；
      - 无 env、XDG/Local 命中；
      - Windows `%LOCALAPPDATA%` 候选兜底。
- [ ] 1.5 验证：`go test ./pkg/aisessions -run 'OpenCodePath|Candidate' -v`；本机命令行打印 `DefaultOpenCodeDBPath()` 命中路径。

**审查门 G1**：本机 `DefaultOpenCodeDBPath()` 返回 `~/.local/share/opencode/opencode.db`（或实际命中路径）；`DefaultProviders` 含 opencode。

## M2 session 表与模型/子会话字段（R2）

- [ ] 2.1 `provider_opencode.go`：新增 `openCodeSessionSelect`（`id,title,directory,path,parent_id,agent,model,time_created,time_updated`）。
- [ ] 2.2 `List` / `loadSummaryByID` 改用新 select，去掉 `model_provider`/`model_id`。
- [ ] 2.3 新增 `parseOpenCodeModel(json)`（容错解析 `id`/`providerID`）→ 填 `summary.Model` / `summary.VendorID`。
- [ ] 2.4 改写 `rowToSummary`：接收 `parent_id`、`model` JSON；填 `Kind`/`ParentKey`（`parent_id` 非空且 ≠ 自身 → `SessionKindSubagent` + `StableKey`）。
- [ ] 2.5 单测：`TestListParsesModelJSON`、`TestListParentIdSubagent`。
- [ ] 2.6 验证：`go test ./pkg/aisessions -run 'OpenCodeList|ModelJSON|ParentId' -v`。

**审查门 G2**：List 不再报 `no such column`；`summary.Model`/`VendorID`/`Kind`/`ParentKey` 正确（fixture 验证）。

## M3 消息与工具读取（R3）

- [ ] 3.1 `loadMessagesNew(ctx, db, sessionID)`：先拉 `message`（按 `time_created, id`），再一次性拉该 session 的 `part`（按 `message_id` 分组），按 `message.id` 关联。
- [ ] 3.2 拼装 `Message`：`role` 取 `message.data.role`；正文 = 该 message 下 `part.data.type='text'` 的 `part.data.text` 以 `"\n\n"` 连接；忽略 reasoning/patch/step-* 进正文。
- [ ] 3.3 `LoadMessages` 主路径改调 `loadMessagesNew`；保留 `session_message`/`message(content列)` 的 V1 回退（防御）。
- [ ] 3.4 `LoadToolCalls` 复用 3.1 的 part 数据，挑 `type='tool'`，提取 name/摘要（对齐 `appendOpenCodeToolCalls` 思路，但输入改为 part map）。
- [ ] 3.5 `loadSnippet` 改用新消息解析（取最后一条有文本消息）。
- [ ] 3.6 单测：`TestLoadMessagesAggregatesTextParts`、`TestLoadMessagesSkipsNonTextParts`、`TestLoadToolCallsFromParts`、`TestLoadSnippet`。
- [ ] 3.7 验证：`go test ./pkg/aisessions -run 'OpenCodeLoad|MessagesAggregat|ToolCallsFromParts|Snippet' -v`。

**审查门 G3**：fixture 下 LoadMessages 返回正确角色/正文；工具调用提取正确；snippet 非空。

## M4 增量加载（R4）

- [ ] 4.1 `provider_opencode.go`：实现 `LoadMessageDelta`，游标基于 `time_created` + 消息计数；复用 3.1 单条拼装。
- [ ] 4.2 `ResetRequired` 在计数回退（db 被重建）时置真。
- [ ] 4.3 单测 `TestLoadMessageDeltaIncremental`：增量只出新消息、游标前进、重复调用幂等。
- [ ] 4.4 验证：`go test ./pkg/aisessions -run 'LoadMessageDelta' -v`；确认 `provider.(MessageDeltaProvider)` 断言通过（若有）。

**审查门 G4**：opencode 不再在 `Manager.LoadDelta` 报 "does not support message delta loading"。

## M5 收尾与手测（AC8/AC9/AC10）

- [ ] 5.1 全量回归：`go test ./pkg/aisessions`（全绿）。
- [ ] 5.2 本机手测：应用以 `--remote-debugging-port=9222` 启动，打开 AI Sessions 面板 → 确认出现 opencode 来源与 ≥1 会话；详情能展开消息；增量刷新不报错。
- [ ] 5.3 `npx tsc --noEmit`（前端无改动，但确认未受影响）。
- [ ] 5.4 跨平台确认：`OPENCODE_DB` 指向 Windows/Linux/macOS 真实路径时探测命中（CI 用 fixture；本机覆盖 Windows 真实路径）。

**审查门 G5**：AC1~AC10 全部勾选；无新增 test failure；codex/claude/pi 无回归。

## 提交策略

分层提交（便于单独回滚，且不与 annotation 改动混）：

1. `fix(aisessions): opencode db 路径探测覆盖 XDG data dir` ← M1
2. `fix(aisessions): opencode provider 适配新 schema（session 表/模型/子会话）` ← M2
3. `fix(aisessions): opencode 消息读取改走 message+part 表` ← M3
4. `feat(aisessions): opencode 增量加载 LoadMessageDelta` ← M4

每步 `git diff --stat` 检查是否误带 annotation 改动；建议把 annotation 那批先提交或 stash 隔离。

## 回滚点

| 回滚到 | 操作 |
|---|---|
| 只回滚增量 | revert 第 4 个 commit；列表面板仍可见（全量加载） |
| 回滚消息读取 | revert 第 3 个 commit；列表可见但详情/工具调用退化 |
| 全部回滚 | revert 全部 4 个 commit → 回到"opencode 不显示"旧态，其他 provider 不受影响 |

## 风险与应对

| 风险 | 触发信号 | 应对 |
|---|---|---|
| opencode schema 再升级 | `no such table/column` 重现 | 解析点集中 + fixture 锁定当前形态；保留 V1 回退 |
| message 无 seq 顺序不稳 | 消息乱序 | 用 `time_created, id` 双键稳定排序 |
| part 聚合在大量会话上慢 | 扫描超时 | 按 session_id 单次批量拉取 + 内存分组；受既有扫描预算约束 |
| 误带 annotation 改动 | commit 混入无关 diff | 每步 `git diff --stat` 核对；建议先隔离 annotation |
| 跨平台路径差异 | 某平台仍扫不到 | M1 多候选 + G1 本机验证 + CI fixture |
