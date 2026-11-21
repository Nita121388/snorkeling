# Agent Roundtrip · 技术设计

## 1. 边界与模块

```
pkg/wshrpc/wshrpctypes.go            AgentSendRequest 扩展 + SessionWaitRequest/Result
pkg/wshrpc/wshserver/agentsend.go    wait-reply 等待窗口 + 完成判定
pkg/wshrpc/wshserver/session_commands.go SessionWaitCommand
pkg/wshrpc/wshserver/replysignal.go  完成判定器（纯函数 + 采集器）
cmd/wsh/cmd/wshcmd-agent.go          --wait-reply/--no-wait/--reply-* flags
cmd/wsh/cmd/wshcmd-session.go         session wait 子命令
pkg/agentmcp/tools.go                 agent_send 扩展 + snorkeling_session_wait
```

不改：`agentstatus` 判定逻辑、dispatch 异步派发、`frontend/**`（gotypes 除外）。

## 2. 完成判定（核心，D1）

「回合完成」不存在单一可靠信号，判定器取三信号交集：

```go
type replyBaseline struct {
    agentSeq   int64     // agentstatus seq（agentsend 已有 agentStatusSeq）
    fileMtime  time.Time // 目标会话 JSONL
    fileSize   int64
    turnCount  int       // 会话索引 turn 总数
}

func replyComplete(base replyBaseline, now replyBaseline) bool {
    return now.agentSeq > base.agentSeq &&
        (now.fileSize > base.fileSize) &&
        now.turnCount > base.turnCount
}
```

- 纯函数可测（状态矩阵单测）；采集器薄封装（agentStatusSeq / manager Summary 的 turn 数 / filestat）。
- **宁可多等一轮**：信号未齐时继续轮询到超时（避免半截回复，见 prd 现状「数据不全」）。
- turnCount 来源：本地 manager 的 `Summary`/info（取现成 turn 计数；若无则用 `session info` 同源函数）。会话文件解析走 `--refresh` 同款单文件路径。

## 3. 时序（D2）

```
AgentSendCommand（既有）成功注入后，若 WaitReply：
  1. 采基线 replyBaseline（注入前采好，随 result 透传）
  2. loop: 每 250ms（--reply-poll-ms，100-2000）采一次
     - replyComplete → break
     - ctx 超时（--reply-wait-ms，默认 60000，上限 300000）→ break(timeout)
     - agentstatus 报 blocked → warnings:[reply-agent-blocked]，继续等（审批流可能自动恢复）
  3. 读取本轮回复：turnCount 基线之后的新 assistant turn（复用 session turn 读取管线，
     chars 预算 --reply-chars 默认 2000 上限 8000；取最后一个 assistant turn）
  4. Result 填 replied/turn/replyText/truncated/totalChars/waitedMs/warnings
```

- 读取失败的容错：回复读取失败 → `replied=true, replyText:"", warnings:["reply-read-failed: <err>"]`（回复确认存在，只是取不回正文；调用方可 `session turn` 自取）。
- 超时不算错误：`replied=false, warnings:["reply-timeout"]`，CLI 退出码 0。

## 4. --no-wait 逃生口（D3）

- 返回 `replyCursor`（基线 turnCount），调用方后续 `wsh session turns <id> --before-turn <cursor+1>` 自取增量。
- **与 Orca 唤醒模型的关系**：`--no-wait` 是「不阻塞但自己轮询」的中间档；真正的事件推送唤醒是 v2（订阅 agentcontrol 事件 + MCP notification），本包不做，设计预留 Result 字段不冲突。

## 5. session wait（D4）

- 数据源：`agentcontrol` live record（`session live` 同源合并器）按 identifier 过滤目标会话状态。
- `--until idle|blocked|done|working`（单值）；命中或超时即返回。
- 超时退出码 3（区别于错误 1）；`matched:false`。

## 6. MCP（D5）

- `snorkeling_agent_send` schema 增 `waitreply/replywaitms/replychars/nowait`（boolean/number/number/boolean），Invoke 直通新字段。
- `snorkeling_session_wait`：scope=observe；identifier/until/timeoutms。
- tools_test 快照更新 + scope 矩阵（observe 放行 wait，data 拒绝 send 的 waitreply 不涉及）。

## 7. 兼容

- `AgentSendResult` 加字段全 optional，既有调用方零影响。
- dispatch 异步派发（Async）路径与 wait-reply 互斥（E_USAGE，在 normalizeSendParams 内校验），不改 dispatch 状态机。

## 8. 测试与真机

- 单测：replyComplete 矩阵（6 组）、参数校验、CLI flag 绑定、MCP schema。
- 真机 verify area `agent-roundtrip`：剧本 = prd AC4-AC8（pi 块 + ROUNDTRIP_OK / 超时 / no-wait 游标 / session wait 命中）。
- 复用 `scripts/verify/lib`（launch/cdp/probes/report），跑完自动关实例，台账入账。

## 9. 回滚

纯新增字段与命令，revert 单 commit 即可；MCP schema 快照随 revert 同步回退。
