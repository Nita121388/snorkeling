# PRD：OpenCode Provider 扫不到会话 —— schema 漂移修复与展示对齐

## 背景与问题

AI Sessions 列表面板看不到任何 OpenCode 会话。不是前端过滤问题，是**后端扫描整条失败**：
OpenCode 的 SQLite schema 已经升级，而 `pkg/aisessions/provider_opencode.go` 的 SQL 还在
按旧 schema 写，全部 `SELECT` 直接报错，provider 注册后被扫描链路丢弃。

### 实测证据（本机 `C:/Users/chemclin/.local/share/opencode/opencode.db`，230MB，24 个 session）

| 层 | 现状（代码假设） | 真实（实测） |
|---|---|---|
| DB 路径 | `os.UserCacheDir()` / `OPENCODE_DB` → `<cache>/opencode/opencode.db` | 本机实际在 `~/.local/share/opencode/opencode.db`；`~/.cache/opencode/` 下只有 `bin/`、`models.json`，**无 db**；`OPENCODE_DB` 未设 → provider 不注册 |
| `session` 表列 | `model_provider, model_id` | 这两列**不存在**；模型在 `model` 列（JSON：`{"id":...,"providerID":...,"variant":...}`）；另有 `parent_id`（3 个非空）、`workspace_id`、`agent`、`path` 等未读列 |
| `session_message` 表 | 列 `role, content, time_created, id`；用 `role='assistant'` 过滤 | 真实列 `id, session_id, type, seq, time_created, time_updated, data`；**无 role / content 列**（代码 `SELECT role, content` 直接炸）；且本机该表 **0 行** |
| 消息落点 | `session_message` | 消息实际在 `message`（1003 行，`id, session_id, time_created, time_updated, data`）与 `part`（4158 行，`message_id, session_id, data`）；`data` 是 JSON，`message.data.role` 取角色，`part.data.type` ∈ `{text,patch,reasoning,tool,step-start,step-finish,compaction}`，`part.data.text` / `part.data.*` 承载内容 |

### 根因链

1. `DefaultOpenCodeDBPath` 用 `os.UserCacheDir()` 拼路径，Windows 上 opencode 实际写入
   `~/.local/share`（XDG data dir），不在 cache dir → 路径错过 → `os.Stat` 失败 →
   `DefaultProviders` 不注册 opencode provider（paths.go:131-138 的 gating）。
2. 即使路径对了，现有 `List` / `LoadMessages` / `LoadToolCalls` 的 `SELECT` 全部引用
   已改名的列（`model_provider`/`model_id`/不存在的 `role`/`content`）→ 任一查询都
   返回 `no such column` 错误，扫描链路把该 provider 整体判为失败。
3. 因此前端 `sources.tsx` 从 `body.sources` 动态取来源时拿不到 opencode，过滤面板无
   opencode 选项，列表面板不渲染 opencode 会话。**前端没有硬编码排除，是后端没数据。**

### 次生缺陷（与 schema 漂移并存）

- `summary.Model` / `summary.VendorID` 取自已消失的 `model_provider`/`model_id` 列 → 即使
  其他修好，模型标签也会空白。
- 子会话树 / 按项目分组（`10-26-aisessions-parent-attach-grouping`，P0）对 opencode 失效：
  代码未读 `parent_id`，`Kind`/`ParentKey` 永远空。真实 `session.parent_id` 有 3 个非空。
- 唯一缺 `LoadMessageDelta` 的 provider → 增量刷新 / 渐进加载对 opencode 报错或回退全量。

## 目标

1. OpenCode 会话出现在 AI Sessions 列表（与 codex / claude / pi 并列）。
2. 列表行正确展示标题、项目路径、更新时间、模型。
3. 详情能正确加载消息与工具调用。
4. 子会话（`parent_id` 非空）能挂到父会话下，参与分组归位任务。
5. 增量/渐进加载对 opencode 可用。

## 非目标

- 不改 OpenCode 自身 schema 或写入行为（只读）。
-. 不改 `message`/`part` 表之外的表解析（event / todo / permission 等不在本次范围）。
- 不改前端过滤框架（source 选项已是动态，修好后端自然出现）。
- 不改 ccswitch opencode 物化（已存在且正确）。

## 需求

### R1 正确发现 DB 路径

**R1.1** `DefaultOpenCodeDBPath` 支持以下探测顺序，命中第一个存在的文件：
1. `OPENCODE_DB` 环境变量（已有）。
2. XDG data home：`$XDG_DATA_HOME/opencode/opencode.db`，回退 `~/.local/share/opencode/opencode.db`。
3. Windows：保留 `%LOCALAPPDATA%/opencode/opencode.db`（覆盖旧 cache 假设）作为候选之一。
4. macOS / Linux 的旧 `~/Library/Caches` / `~/.cache` 路径作为候选兜底。

**R1.2** `DefaultProviders` 的 gating 不变（仍 `os.Stat` 存在才注册），但探测函数需覆盖
本机真实路径，使注册发生。

**R1.3** Windows 上明确 XDG data dir 读取（`$XDG_DATA_HOME` 或 `%LOCALAPPDATA%/../Local` 的
等价）。实测本机走 `~/.local/share`（git bash 下 `os.UserCacheDir()` 也指向此处时例外——
需实测确认，见 implement M1 的探测顺序与单测）。

### R2 修复 `session` 表解析（新 schema）

**R2.1** `List` / `loadSummaryByID` 改为 select 真实存在的列：
`id, title, directory, path, parent_id, agent, model, time_created, time_updated`。
（去掉 `model_provider`/`model_id`。）

**R2.2** `model` 列是 JSON：`{"id":..., "providerID":..., "variant":...}`。
解析出：
- `summary.Model = model.id`（展示用，如 `space-bunny-free`）
- `summary.VendorID = model.providerID`（如 `opencode-go`）

**R2.3** `rowToSummary` 填 `Kind` 与 `ParentKey`：
- `parent_id` 非空（且 ≠ 自身 id）→ `Kind = SessionKindSubagent`、`ParentKey = StableKey(SourceOpenCode, parent_id, dbPath+"#"+parent_id)`。
- 否则 `Kind = SessionKindSession`。

**R2.4** `ProjectPath` 用 `directory` 列（真实存在，如 `D:/Code/LiCASmart`）。
`title` 归一化逻辑保留（空 → 用 `directory` basename → 用 id）。

### R3 修复消息读取（`message` + `part` 表）

**R3.1** `LoadMessages(filePath)` 改为：
- 主路径从 `message` 表按 `session_id` 顺序读取（按 `time_created, id` 排序，因无独立 seq
  列稳妥起见用 `time_created, id` 作为稳定顺序）。
- 每条 `message.data` 是 JSON：`role`（`user`/`assistant`/`system`）在 `data.role`；
  正文文本从关联的 `part` 表聚合：`part.message_id = message.id` 且 `part.data.type='text'`
  的 `part.data.text` 拼成正文。
- 工具调用从 `part.data.type='tool'` 的条目提取（`part.data` 含工具名与参数）。

**R3.2** V1 回退保留：当 `message` 表不存在时回退到旧 `session_message`（如仍存在）
或旧 `message(content 列)` 兼容形态；但本机实测 `message` 表为新形态，旧回退作为防御保留。

**R3.3** `LoadToolCalls(filePath)` 复用 R3.1 的 part 解析，过滤 `type='tool'`，
提取 `name`（part.data 的工具名）与参数摘要。

**R3.4** `loadSnippet` 改用 R3.1 的消息正文（取最后一条带文本的用户/助手消息）。

### R4 增量加载（`LoadMessageDelta`）

**R4.1** opencode provider 实现 `MessageDeltaProvider` 接口（`LoadMessageDelta`），
基于 `message` 表的 `time_created`（+ `id`）做游标增量，对齐 codex/claude/pi 的
`MessageDelta` 结构（`Cursor{MTime,FileSize,Extra}` + 增量 `Messages`）。

**R4.2** 复用 R3.1 的单条消息解析（从 message+part 拼装），避免重复逻辑。

### R5 注册与降级健壮性

**R5.1** opencode provider 注册失败（db 不存在 / 打开失败）时静默跳过，不打断
codex/claude/pi 的扫描（已满足，确认即可）。

**R5.2** 单测用 fixture 构造符合新 schema 的 SQLite（或内存 db + 注入），覆盖
R1~R4，不依赖本机真实 db。

## 验收标准

- [ ] AC1 本机 AI Sessions 列表出现 OpenCode 来源选项，且能列出 ≥1 个 opencode 会话（实测 24 个）。
- [ ] AC2 opencode 会话列表行展示正确标题（非空优先 title，否则目录名）、项目路径、更新时间。
- [ ] AC3 opencode 会话详情能加载消息（用户/助手文本），不报错。
- [ ] AC4 opencode 会话能提取工具调用（如存在 `part.type='tool'`）。
- [ ] AC5 opencode 会话模型标签非空（取 `model.id`，实测 `space-bunny-free`）。
- [ ] AC6 含 `parent_id` 的 opencode 会话被标记为子会话（`Kind=subagent`，`ParentKey` 非空），能参与父级归位。
- [ ] AC7 opencode 会话支持增量加载（`LoadMessageDelta` 不返回 "does not support"）。
- [ ] AC8 `go test ./pkg/aisessions` 全绿；本机手测 `opencode.db` 扫描无 `no such column` 错误。
- [ ] AC9 现有 codex/claude/pi 功能无回归（opencode 改动隔离在自身 provider）。
- [ ] AC10 Windows 与 macOS/Linux 下 DB 路径探测均能命中真实 opencode 数据目录。

## 测试环境

```
Windows 11 开发机（本机）
opencode db: C:/Users/chemclin/.local/share/opencode/opencode.db（24 session / 1003 message / 4158 part）
断言以 fixture 内存 SQLite 为准，不依赖本机 db（CI 可跑）。
```

## 风险

| 风险 | 缓解 |
|---|---|
| opencode schema 仍可能随版本再变 | provider 内集中解析点（R2/R3），单测用 fixture 锁定当前形态；保留 V1 回退 |
| 路径探测跨平台差异 | R1 多候选顺序 + 单测覆盖 Windows/macOS/Linux；gating 仍按存在性 |
| message 无 seq 列导致顺序不稳 | R3.1 用 `time_created, id` 双键排序，稳定且可复现 |
| part 聚合性能（4158 行） | 按 session_id 一次性拉取并内存分组，单次查询；限流已有扫描预算 |
| 影响父级归位任务（10-26） | R2.3 补 `Kind`/`ParentKey` 后，opencode 自动纳入该任务的分组逻辑 |

## 里程碑

- M1 路径探测修复（R1，AC1/AC10）
- M2 session 表 + 模型 + 子会话字段（R2，AC2/AC5/AC6）
- M3 message+part 消息与工具读取（R3，AC3/AC4）
- M4 增量加载（R4，AC7）
- M5 单测与手测（AC8/AC9）
