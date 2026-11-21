# Agent Resume · 技术设计

## 1. 边界与模块

```
cmd/wsh/cmd/wshcmd-agent-resume.go      CLI 组装（flags → RPC）
pkg/wshrpc/wshrpctypes.go                AgentResumeRequest/Result、SessionMarkRequest/Result DTO
pkg/wshrpc/wshserver/agentresume.go     AgentResumeCommand（编排：解析→上下文→meta→建块→可选注入）
pkg/wshrpc/wshserver/session_commands.go SessionMarkCommand（薄封装）
pkg/agentcontrol/restore.go              BuildRestoreContext + BuildResumeBlockMeta（纯函数，可测）
pkg/agentmcp/tools.go                    snorkeling_agent_resume / snorkeling_session_mark
```

不改：`frontend/**`（零前端改动，gotypes 再生成除外）、`pkg/aisessions/manager.go`（Mark 已有）、GUI 恢复链路。

## 2. DTO

```go
type AgentResumeRequest struct {
    Identifier string `json:"identifier"`           // session key / id / "this"
    BlockId    string `json:"blockid,omitempty"`    // "this" 解析用
    Connection string `json:"connection,omitempty"` // remote 拒绝判定，同 launch
    Tab        string `json:"tab,omitempty"`        // active|new|<tabid>
    WorkspaceId string `json:"workspaceid,omitempty"`
    Cwd        string `json:"cwd,omitempty"`        // 覆盖 projectpath
    NoFocus    bool   `json:"nofocus,omitempty"`
    WaitMs     int    `json:"waitms,omitempty"`     // layout applied 等待，默认 5000
    // --send 组合（字段语义与 AgentSendRequest 完全一致，复用 normalizeSendParams）
    Send           *string `json:"send,omitempty"`
    SendText64     string  `json:"sendtext64,omitempty"`
    Submit         *bool   `json:"submit,omitempty"`
    SendWait      *bool   `json:"sendwait,omitempty"`
    SendWaitMs    int     `json:"sendwaitms,omitempty"`
    QuietMs       int     `json:"quietms,omitempty"`
    SubmitDelayMs int     `json:"submitdelayms,omitempty"`
}

type AgentResumeResult struct {
    Version     string   `json:"version"`
    Ok          bool     `json:"ok"`
    BlockId     string   `json:"blockid"`
    SessionId   string   `json:"sessionid"`
    Source      string   `json:"source"`
    ProjectPath string   `json:"projectpath,omitempty"`
    SyncState   string   `json:"syncstate,omitempty"`
    Warnings    []string `json:"warnings,omitempty"`
    Send        *AgentSendResult `json:"send,omitempty"` // --send 时填充
}
```

`SessionMarkRequest{ Identifier, BlockId, Marked bool }` / 复用 card 结果字段子集。

## 3. 恢复上下文：单一实现（D1）

`RestoreContext` 的 claude vendor 解析在 service 包。为避免两份实现漂移：

- 把「summary → vendor 信息」的解析抽成 `pkg/agentcontrol/restore.go` 的 `ResolveRestoreContext(ctx, summary) (*RestoreContext, error)`（claude 分支复用 `ccswitch.ResolveClaudeVendorSessionPath` + `ListClaudeVendors`，非 claude 直接返回）。
- `aisessionsservice.RestoreContext` 在 summary 之后的部分**改为调用同一函数**（service 保留 managerForScope 路由职责）。
- 若抽离导致 import 方向问题（service → agentcontrol 或反向），退化方案：agentcontrol 独立实现 + parity 单测双锁（在 implement 里先试抽离，测试不过再退化，退化要在 PRD Notes 里回写）。

## 4. meta parity 与 gemini 差异（D2/D4）

`BuildResumeBlockMeta(ctx RestoreContext, cwdOverride string) waveobj.MetaMapType`：

| 前端键 | 来源 | 备注 |
|---|---|---|
| view/controller/cmd/cmd:shell/cmd:runonstart/cmd:jwt | 常量 term/cmd/AgentResumeCmdBySource | 与前端 `AgentResumeCmdBySource` 同表：claude→claude, codex→codex, opencode→opencode, pi→pi |
| agent:autoresume / agent:provider / agent:sessionid | RestoreContext | true / source / sessionid |
| cmd:cwd | projectpath 或 --cwd 覆盖 | |
| cmd:env CLAUDE_CONFIG_DIR + agent:claudevendorid/vendorname | claude vendor | 仅 claude+configdir |

parity 测试：`pkg/agentcontrol/restore_test.go` 用五组 golden fixture（内嵌 JSON），并断言与 `frontend/app/view/aisessions/utils.ts` 的 `AgentResumeCmdBySource` 表一致（前端表变更必须同步测试 fixture；注释里互相指认）。

**gemini 差异**：前端 `?? "codex"` 兜底对 gemini 是错误行为（gemini 会话用 codex cmd 恢复必然失败）。后端对未知 source 返回 `E_USAGE`，hint 写明「GUI 的 gemini 恢复是既知缺陷，另包处理」。**不做静默 fallback。**

## 5. session mark 不走 agentdata（D5）

agentdata patch 门（备份/审计/expectedHash）保护的是**人写内容**（note/title/tags/props）。marked 是布尔视图状态：
- 冲突无害（toggle 幂等，last-write-wins）；
- GUI 的 toggleMark 本就直连 `Manager.Mark`，无 hash 门；
- 给 toggle 加 dry-run/hash 会把简单操作变三步。

结论：CLI/MCP 与 GUI 走同一函数 `Manager.Mark`，不加第二层门。若后续审计要求，可由 `Manager.Mark` 内部补 audit 行（本包不做）。

## 6. 编排时序（AgentResumeCommand）

```
1. validateLaunchConnection（remote → E_NOT_SUPPORTED）
2. ResolveSessionIdentifier → E_NOT_FOUND
3. manager.Summary（本地 manager）→ summary
4. ResolveRestoreContext（claude vendor → E_VENDOR_UNAVAILABLE）
5. source 白名单校验（claude/codex/opencode/pi，否则 E_USAGE）
6. BuildResumeBlockMeta（cwd 覆盖）
7. resolveTabTarget → CreateBlockCommand（Focused: !NoFocus）
8. waitForLayoutApplied（WaitMs）
9. 若 Send：构造 AgentSendRequest{BlockId: 新块} → 复用 AgentSendCommand 内部路径
   （注入失败不回滚块，错误带 blockid，同 11-18 R1 原子语义）
10. Result 汇总（send 子结果内嵌）
```

注入复用方式：`agentsend.go` 抽 `deliverAgentSend` 之上再无必要；`AgentResumeCommand` 直接调用 `ws.AgentSendCommand(ctx, wshrpc.AgentSendRequest{BlockId: blockId, ...})`，避免复制管线（该函数已具备就绪门+确认+回执，MCP/CLI 复用同一入口）。

## 7. 错误码

| 码 | 场景 |
|---|---|
| E_NOT_FOUND | 会话不存在 |
| E_NOT_SUPPORTED | remote 连接 |
| E_USAGE | 未知 source / --tab new 无 --workspace 等参数错误 |
| E_VENDOR_UNAVAILABLE | claude vendor 解析失败（与 GUI 同口径） |
| E_AGENT_NOT_READY | --send 就绪超时（不回滚块） |

沿用 `agentcontrol.newError` 的 code/hint 机制，CLI 层翻译为退出码非 0 + stderr。

## 8. MCP

- `snorkeling_agent_resume`：Scope=launch；schema 键与 DTO json tag 一致（identifier 必填，send/submit/wait 组可选）。
- `snorkeling_session_mark`：Scope=data；identifier/marked 必填。
- tools_test 增加快照断言 + scope 断言（data token 调 resume → E_FORBIDDEN 工具不可见）。

## 9. 兼容与回滚

- 纯新增命令/工具，不动既有行为；`RestoreContext` 抽离为等价重构（service 测试全绿为界）。
- 回滚：revert 单 commit 即可（无 schema/迁移）。

## 10. 测试与真机

- 单测：restore parity golden（5 组）、meta 构造（cwd 覆盖/vendor）、CLI 参数绑定、MCP schema/scope。
- 真机：新 verify area `agent-resume`（复制 `scripts/verify/_template`，能力只从 `scripts/verify/lib` 拿），剧本 = AC4-AC8；跑完自动关，`verify-ledger.md` 入账，`docs/project/ui-verify-playbook.md` 或 spec 回写踩坑。
- gotypes 再生成（wsh 类型重生成任务，与 frontend/types/gotypes.d.ts 一致）。
