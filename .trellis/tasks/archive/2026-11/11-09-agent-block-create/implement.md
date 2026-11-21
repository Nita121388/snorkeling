# Implement: Agent Block 程序化创建（`wsh agent launch`）

## 顺序清单

1. **catalog 透传 env**
   - `pkg/agentcatalog/catalog.go`：`ProfileInfo` 增加 `Env map[string]string`，`resolveWithConfig` 从 `cfg.CmdEnv` 拷贝（copy，不共享 map）。
   - 单测：`catalog_test.go` 断言 settings 里配的 env 出现在 `ProfileInfo.Env`。

2. **scope**
   - `pkg/agentscope/scope.go`：加 `Launch = "launch"`，顺序常量表插入 `data < launch < destructive`；`commandScopes["agentlaunch"] = Launch`。
   - 单测更新 `scope_test.go`（含 `data` 不满足 `launch`、`destructive` 满足 `launch`）。

3. **DTO + 接口**
   - `pkg/wshrpc/wshrpctypes.go`：`AgentLaunchRequest` / `AgentLaunchResult`，`WshServerCommand` 加 `AgentLaunchCommand(ctx, data AgentLaunchRequest) (*AgentLaunchResult, error)`。
   - 位置紧邻 `BlockOpenRequest` / `AgentCard*`，便于同族阅读。

4. **后端实现** `pkg/wshrpc/wshserver/agentlaunch.go`
   - 纯函数：`resolveAgentLaunchProfile(model, settings)` → `(agentcatalog.ProfileInfo, resolvedModel string, err error)`。
   - 纯函数：`buildAgentBlockMeta(profile, resolvedModel, request) waveobj.MetaMapType`。
   - 纯函数：`validateLaunchConnection(conn string) error`（非空且非 local → `E_UNSUPPORTED`）。
   - 复用：`resolveTabTarget`（由 `resolveOpenTabId` 泛化而来，`block_commands.go` 同步改调用点）、`splitTargetAction`、`lastBlockInTab`、`CreateBlockCommand`、`waitLayoutApplied`（从 `BlockOpenCommand` 抽出，两处共用）。
   - 错误码：`E_USAGE` / `E_PROFILE_UNKNOWN` / `E_MODEL_NOT_IN_CATALOG` / `E_NOT_FOUND` / `E_UNSUPPORTED`。
   - 单测 `agentlaunch_test.go`：profile 不存在、裸 id 命中、`provider/id` 命中、候选上限、opencode 无 models、meta 关键字段、`--model` 缺省时不含 args。

5. **CLI** `cmd/wsh/cmd/wshcmd-agent-launch.go`
   - `agentCmd.AddCommand(agentLaunchCmd)`；`--profile` 必填（`cobra.MarkFlagRequired`），其余对齐 design §3。
   - `--json` 输出完整结果；非 json 输出 `launched pi (deepseek/deepseek-v4-flash) block=... tab=... sync=...`。
   - 失败时退出码非 0 且 stderr 带错误码。

6. **生成绑定**：`go run cmd/generatets/main-generatets.go && go run cmd/generatego/main-generatego.go`（等价 `task generate`，但先只跑这两个以跳过 schema 依赖）。

7. **MCP 工具**
   - `pkg/agentmcp/tools.go`：`snorkeling_agent_create`（Scope `launch`），参数 profile/model/tab/workspaceid/cwd/split/nofocus/wait/waitms。
   - `Backend` 接口加 `AgentLaunch`；`cmd/wsh/cmd/wshcmd-mcp.go` 的 `rpcBackend` 实现。

8. **R7 `defwidget@agent`**
   - `cmd/wsh/cmd/wshcmd-launch.go`：`widgetId == "defwidget@agent"` 时改为调用 `AgentLaunchCommand`，profile 取 catalog 默认，其它 flag 透传（`--magnify` → `--magnified`）。
   - 不允许硬编码任何 agent 名。

9. **发现面**：`pkg/agentcap/agentcap.go` GuideText 增加 `wsh agent launch` 用法与三条约束（只能选目录内 profile/model；不接受 cmd 注入；`--wait` 只保证 layout）。

10. **验证**
    - `go build ./...`
    - `go test ./pkg/agentcatalog ./pkg/agentscope ./pkg/wshrpc/wshserver ./pkg/agentmcp ./cmd/wsh/...`
    - 真机：`wsh agent launch --profile pi --tab active --wait --json` → `syncstate=layout-applied`，随后关闭该块。
    - `docs/project/verify-ledger.md` 记一行结论（若真机台未建则写 skipped 原因）。

## 顺序依赖

- 步骤 1、2 无依赖，可并行。
- 步骤 3 影响 4、5、7，必须先落。
- 步骤 6 必须在 5、7 之后（否则生成物缺命令）。
- 步骤 8 依赖 5（同一 RPC 已存在）。

## 回滚点

- 步骤 1–7 合为一个 commit；步骤 8（`defwidget@agent` 行为变更）单独 commit；步骤 9 可并入前者。

## 判据（与 prd.md 验收项对应）

见 `prd.md` 的 11 条判据；本次实现必须逐条有输出证据，缺真机台的项在台账写明原因而不是静默省略。
