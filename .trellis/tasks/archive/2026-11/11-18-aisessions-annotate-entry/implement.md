# 执行计划：批注写入口 `session annotate`

设计：本目录 `design.md`；PRD：本目录 `prd.md`；冻结规则：`.trellis/spec/snorkeling-docs/backend/aisessions-annotation-contract.md`。

## 步骤 1 覆盖语义（地基，先测后写）

- [x] `pkg/aisessions/annotation_store.go`：新增 `UpsertMachineAnnotation(ctx, row) (AnnotationRow, bool /*created*/, error)`
  - 单事务；查同 `(session_key, kind, anchor_key)` 且 `source='ai'` 的行
  - `CanReplace` → 删旧插新，返回 `created=false` + 旧 id
  - `!CanReplace` → 返回哨兵错误（`ErrAnnotationProtected`），不写
  - 事务内只用 `tx`（单连接池，禁 `idx.db`）
- [x] 单测 `annotation_machine_test.go`：插入 / 同锚点覆盖（总数不增、updated_at 变）/ 人改过拒绝 / `source=user` 拒绝 / 不同 kind 不互相覆盖 / 其它 AI 草稿不受影响

**判据**：`go test ./pkg/aisessions -run MachineAnnotation -v` 全绿。

## 步骤 2 service `SessionAnnotate`

- [x] `pkg/service/aisessionsservice/sessionannotate.go`（或并入现有文件）：`SessionAnnotate` + `_Meta`
  - `managerForScope` → summary（取 `HashSession` 用）
  - 锚点解析：`tail` / itemKey 校验（`loadDetailForAnnotations` + `BuildAnnotationAnchors`），未命中 `E_NOT_FOUND`
  - 强制 `source=ai`；`status` 缺省 `draft`；`accepted` 无 `force` → `E_USAGE`
  - 真写校验 `expectedHash`（`agentdata.HashSession(summary)` 严格比较），不符 `E_CONFLICT`
  - dry-run 返回 preview，不写库
  - `ErrAnnotationProtected` → `E_CONFLICT` + hint
- [x] RPC：`wshrpc` DTO + interface + `wshserver` 薄转发；`go run cmd/generatego`（纯新增）

**判据**：`go test ./pkg/service/aisessionsservice -run SessionAnnotate -v` 全绿（dry-run 不落库、hash 不符拒绝、accepted 需 force、幻觉锚点拒绝）。

## 步骤 3 internal/ACS 组装（照现有分层）

- [x] `pkg/agentcontrol/session_annotate.go`：`SessionAnnotate(ctx, req)` 组装 + 错误码映射（`E_USAGE` / `E_NOT_FOUND` / `E_CONFLICT`）
- [x] 单测：错误码映射 + dry-run 透传

**判据**：`go test ./pkg/agentcontrol -run Annotate -v` 全绿。

## 步骤 4 CLI

- [x] `cmd/wsh/cmd/wshcmd-session.go`：`session annotate <id>`，flags 见 design §7；`--json` 两态
- [x] 人类可读：`would write · preview` / `wrote · id=N (created|replaced id=M)`

**判据**：`go build ./cmd/wsh` 通过；无 `--yes` 时输出 dry-run 且不写库（用 fixture 或临时库验证）；`--yes` 缺 `--expected-hash` 报错；`--status accepted` 无 `--force` 报错。

## 步骤 5 MCP

- [x] `pkg/agentmcp/tools.go`：`snorkeling_session_annotate`，`confirm:false` 默认 dry-run、`confirm:true` 真写、`expectedhash` 必填
- [x] `pkg/agentscope`：工具 → 写类 scope（对齐 `snorkeling_agent_card_set`）
- [x] 单测：schema（required / confirm 语义）、工具数 N→N+1

**判据**：`go test ./pkg/agentmcp ./pkg/agentscope -v` 全绿。

## 步骤 6 广告与文档

- [x] `pkg/agentcap` / `pkg/agentguide`：命令与工具进入发现面（不可发现 = 不存在）
- [x] `docs/project/agent-control-surface.md`：加 `session annotate` 一节（默认 draft、hash 门禁、覆盖语义）

**判据**：`go test ./pkg/agentcap ./pkg/agentguide -v` 全绿。

## 步骤 7 端到端判据（交验收）

- [x] fixture 会话上采集：
  - 幻觉锚点 → `E_NOT_FOUND`，库里无残留（AC1）
  - 默认写 `status=draft, source=ai`；`--status accepted` 无 `--force` 拒绝（AC2）
  - 同锚点重复写：覆盖、`updated_at` 变、总数不增（AC3）
  - `--expected-hash` 不符拒绝（AC4）
  - MCP 默认 dry-run、`confirm:true` 才写，参数与 CLI 对齐（AC5）
  - GUI 打开会话能看到 draft（人工验证一次，发版后冒烟）（AC6）
- [x] 结果写本文件「判据数字」小节

**判据**：`go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/... ./pkg/agentcontrol/... ./pkg/agentmcp/... ./pkg/agentscope/...` 全绿 + 上面逐条数字。

## 回滚点

- 步骤 1 独立（纯新增方法，不改既有路径）。
- 步骤 2-3 未接 CLI/MCP 前对外零影响。
- 步骤 4-5 回滚只需删命令注册与工具条目。

## 判据数字（2026-11-18 采集）

### 单测 / 构建

```
go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/... ./pkg/agentcontrol/...
      ./pkg/agentmcp/... ./pkg/agentscope/... ./pkg/agentcap/... -count=1   全 ok（含 chat 子包）
go build ./cmd/wsh ✓   go vet ✓   gofmt（改动文件）✓   工具数 18 → 19
```

### 核心判据实测

| 判据 | 输出 |
|---|---|
| 重复写同锚点总数不增 | `first_id=1 → second_id=2 replaced_id=1 rows=1`（`TestMachineAnnotationReplaceKeepsCount`） |
| 人改过拒绝覆盖 | `err=annotation is protected… rows=1 title="human fixed"`；ACS 层 `code=E_CONFLICT`（`TestMachineAnnotationRejectsHumanEdited`） |
| 幻觉锚点无残留 | `E_NOT_FOUND`，库中 0 行（`TestSessionAnnotateHallucinatedAnchor`） |
| 门禁 | 真写缺 hash / hash 不符 → `E_USAGE` / `E_CONFLICT`；`accepted` 无 `--force` 拒绝；MCP 默认 dry-run、`confirm+expectedhash` 才写 |
| 数据安全 | 只删同 `(session,kind,anchor)` 且 `CanReplace` 的行；其它 AI 草稿不受影响（`TestMachineAnnotationLeavesOtherDraftsAlone`） |

### check 代理补的两处修复（都在新增代码内）

1. store 层 status 严格校验：垃圾 status 不再被归一成 `accepted`（`TestMachineAnnotationRejectsInvalidStatusAtStore`）。
2. 同 identity 重复行收敛：事务内删除**全部** `CanReplace` 行，不再残留旧草稿（`TestMachineAnnotationConvergesDuplicateDrafts`）。

### 已接受的 design 偏离（check 独立复核认可）

1. 查重范围：查同 `(session,kind,anchor)` **最新行不论 source**（原 design 只查 ai）——人写在同锚点时机器宁可失败。
2. dry-run 也做保护判定与 replaced 预览（只读、不开事务），dry-run 与真写回答同一问题。

### 未覆盖（显式声明）

- AC6 GUI 冒烟与真机 CLI：待发版。
- MCP schema 未暴露 `blockid`（`'this'` 经 MCP 不可解析）——已记 TODO，见 check 建议 1。
