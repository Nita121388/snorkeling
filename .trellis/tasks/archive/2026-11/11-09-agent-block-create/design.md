# Design: Agent Block 程序化创建（`wsh agent launch`）

## 1. 边界与不变量

| 不变量 | 实现约束 |
|---|---|
| 只有一条建块路径 | `AgentLaunchCommand` 组装 meta 后调用现有 `WshServer.CreateBlockCommand`，不新增第二种写入 |
| agent/模型唯一事实源 | `pkg/agentcatalog`（与 `wsh agent list`、定时任务编辑器同一份） |
| 调用方不能注入命令 | RPC 不接受 `cmd` / `cmd:env` / 任意 meta；只接受 profile + model + 目标位置 |
| 未知 profile 不兜底 | `agentcatalog.Resolve` 对未知名字会兜底成「跑同名二进制」，launch 必须先做存在性校验并用 `E_PROFILE_UNKNOWN` 拒绝 |
| 校验失败不产生副作用 | 所有校验在建块之前完成；失败时块数量不变 |
| 不改 GUI 流程 | 前端 `agent-launch.ts` 一行不动，WidgetsBar 走原路 |

## 2. 分层

```
cmd/wsh/cmd/wshcmd-agent-launch.go      CLI（flag → DTO，--json 输出）
pkg/wshrpc/wshrpctypes.go               AgentLaunchRequest / AgentLaunchResult + 接口方法
pkg/wshrpc/wshclient/wshclient.go       （生成）
pkg/wshrpc/wshserver/agentlaunch.go     校验 + meta 构造（纯函数）+ tab 解析 + 建块 + wait
pkg/agentcatalog/catalog.go             ProfileInfo 增 Env 字段（profile 的 env 透传）
pkg/agentscope/scope.go                 新 scope `launch`
pkg/agentmcp/tools.go + provider        MCP 工具 snorkeling_agent_create
pkg/agentcap/agentcap.go                GuideText 广告该命令
```

纯函数放 `agentlaunch.go` 内、可直接单测（`agentlaunch_test.go`），不引入新包、不产生 import 环。

## 3. 请求/响应契约

```go
type AgentLaunchRequest struct {
    Profile     string `json:"profile"`            // 必填，必须命中 catalog
    Model       string `json:"model,omitempty"`    // "id" 或 "provider/id"；空 = defaultModel
    Tab         string `json:"tab,omitempty"`      // active(默认) | new | <tabid>
    WorkspaceId string `json:"workspaceid,omitempty"` // 仅 tab=new
    Split       string `json:"split,omitempty"`    // right|down|left|up
    Cwd         string `json:"cwd,omitempty"`
    Connection  string `json:"connection,omitempty"` // 仅 local 支持；非空且非 local 的远端暂不支持
    Magnified   bool   `json:"magnified,omitempty"`
    NoFocus     bool   `json:"nofocus,omitempty"`
    Wait        bool   `json:"wait,omitempty"`
    WaitMs      int    `json:"waitms,omitempty"`
}

type AgentLaunchResult struct {
    Version   int               `json:"version"`
    Ok        bool              `json:"ok"`
    TabId     string            `json:"tabid"`
    BlockId   string            `json:"blockid"`
    Profile   string            `json:"profile"`
    Model     string            `json:"model,omitempty"`   // 实际使用的 model（含 provider/id）
    Cmd       string            `json:"cmd"`
    Args      []string          `json:"args,omitempty"`
    Isolation string            `json:"isolationmode"`     // 本轮恒为 system
    SyncState string            `json:"syncstate"`         // db-only | layout-queued | layout-applied
    WaitedMs  int               `json:"waitedms,omitempty"`
    Meta      map[string]any    `json:"meta,omitempty"`    // 关键 meta（cmd/args/agent:*）回显，便于断言
    Warnings  []string          `json:"warnings,omitempty"`
}
```

`SyncState` 语义与 `BlockOpenResult` 逐字一致（复用同一常量与同一轮询实现），不新增第三态。

## 4. 模型校验规则（R3）

解析顺序：

1. `--model` 为空 → `profile.DefaultModel`；为空则不追加 `--model`。
2. 形如 `provider/id`（含 `/`）→ 必须在 `profile.Models` 中找到 `Provider == provider && Id == id`。
3. 裸 `id` → 必须在 `profile.Models` 中找到 `Id == id`。
4. 命中后透传原值（pi 原生支持 `provider/id`）。
5. 未命中 → `E_MODEL_NOT_IN_CATALOG`，附候选（最多 20 条，`provider/id` 优先展示），**不建块**。

`profile.ModelFlag` 为空时退化为 `--model`（与前端 `DefaultModelFlag` 一致）；opencode 无模型列表时 `Models` 为空，此时传 `--model` 一律 `E_MODEL_NOT_IN_CATALOG`（避免把用户显式指定静默丢掉）。

## 5. meta 契约（与 GUI 建块对齐）

| key | 值 |
|---|---|
| `view` | `term` |
| `controller` | `cmd` |
| `cmd` | `profile.Cmd` |
| `cmd:shell` | `false` |
| `cmd:runonstart` | `true` |
| `cmd:jwt` | `true` |
| `cmd:args` | `profile.Args` + （有 model 时）`[modelFlag, model]`；为空则不写 |
| `cmd:env` | `profile.Env`（合并后非空才写） |
| `cmd:cwd` | 仅传 `--cwd` 时写 |
| `connection` | 仅传 `--connection` 时写 |
| `agent:autoresume` | `true` |
| `agent:provider` | `filepath.Base(profile.Cmd)`（与前端 `resolveAgentProvider` 同义） |
| `agent:isolationmode` | `system` |
| `agent:requestedmodel` | 仅在有 model 时写 |

`ProfileInfo` 新增 `Env map[string]string`（源自 `agent:profiles.<name>.env`），否则程序化建块会丢 profile env，与 GUI 块不一致。

## 6. 目标解析

- `--tab active`（默认）：复用 `resolveOpenTabId` 的 active 分支（client → window → workspace.ActiveTabId）。
- `--tab new`：`wcore.CreateTab`（与 `block open --tab new` 同一实现）。
- `--tab <tabid>`：`DBMustGet[*waveobj.Tab]` 校验存在，否则 `E_NOT_FOUND`。
- `--split`：复用 `splitTargetAction` + `lastBlockInTab`。
- `--wait`：复用 `BlockOpenCommand` 的 `wcore.LayoutAppliedToFrontend` 轮询，默认 5s。

因此把 `resolveOpenTabId` 泛化为 `resolveTabTarget(ctx, tab, workspaceId)`，`block open` 与 `agent launch` 共用，避免两份 Tab 解析漂移。

## 7. scope 与发现

- `agentscope` 级别：`observe < navigate < data < launch < destructive`；`Allows` 是「高级覆盖低级」的既有实现，插入 `launch` 后 `destructive` 仍覆盖它。
- `RequiredForCommand("agentlaunch") == launch`。
- MCP：`snorkeling_agent_create`（`Scope: ScopeLaunch`），走同一 RPC。
- `agentcap.GuideText` 增加一节，否则外部 agent 发现不了（ACS「Adding a surface」第 5 步）。

## 8. 兼容与回滚

- `ProfileInfo` 加字段是 additive；`agent list --json` 消费者按字段名读取，不受影响。
- 回滚单位：单个 commit（新增文件 + 少量 additive 编辑），无 DB/schema 迁移。
- `defwidget@agent` 行为变更（R7）单独一个 commit，便于单独回退。

## 9. 风险

| 风险 | 处置 |
|---|---|
| 生成绑定忘记刷新 → CLI 编译失败 | implement.md 固定 `generate` 步骤并作为判据 |
| `--profile` 命中但 cmd 不存在于 PATH | 不改行为：进程启动失败由块错误呈现（与 GUI 一致），launch 只做事前目录校验 |
| 远端连接建块 | 本轮显式拒绝非本机 `--connection`（`E_UNSUPPORTED`），避免进入未验证的路由 |
| 建块产生真实进程 | 验证脚本必须关闭块（`scripts/verify` 出口约定） |
