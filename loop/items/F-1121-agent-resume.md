---
id: F-1121-agent-resume
title: "ACS：agent resume（按会话恢复 agent 块）+ session mark"
type: arch
priority: P1
status: open
origin: self
source: "nita 2026-11-21 布置：外部 agent 需要能查询筛选会话、恢复会话、给会话补充信息；本包 = 恢复会话 + marked 写入口"
task: 11-21-agent-resume
order: 100
touch: [pkg/wshrpc/wshrpctypes.go, pkg/wshrpc/wshclient/wshclient.go, pkg/wshrpc/wshserver/agentresume.go, pkg/wshrpc/wshserver/agentresume_test.go, pkg/wshrpc/wshserver/agentsend.go, pkg/wshrpc/wshserver/agentlaunch.go, pkg/wshrpc/wshserver/session_commands.go, pkg/agentcontrol/restore.go, pkg/agentcontrol/restore_test.go, pkg/service/aisessionsservice/aisessionsservice.go, cmd/wsh/cmd/wshcmd-agent-resume.go, cmd/wsh/cmd/wshcmd-agent-resume_test.go, cmd/wsh/cmd/wshcmd-agent.go, cmd/wsh/cmd/wshcmd-session.go, pkg/agentmcp/tools.go, pkg/agentmcp/server_test.go, pkg/agentscope/scope.go, cmd/wsh/cmd/wshcmd-mcp.go, frontend/types/gotypes.d.ts, frontend/app/store/wshclientapi.ts, scripts/verify/agent-resume/**, scripts/verify/README.md, docs/project/verify-ledger.md, docs/project/ui-verify-playbook.md, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 480, retries: 2}
releaseCandidate: false
createdAt: "2026-11-21T14:55:10Z"
---

# ACS：agent resume（按会话恢复 agent 块）+ session mark

## 背景

GUI 已有完整恢复链路（`RestoreContext` → `restoreMetaForSession` → `createBlock`），后端 shellcontroller 也已消费 `agent:autoresume/agent:provider/agent:sessionid` 生成真实 resume 参数。缺的是 CLI/MCP 入口：外部 agent 无法「按会话续上」。同时 `session mark` 只有 GUI 入口。

## 来源

- self：nita 2026-11-21 布置（外部 agent 三件事：查询筛选 / 恢复 / 补充信息），本包承担恢复 + marked 写入口。需求全文见 `.trellis/tasks/11-21-agent-resume/prd.md`。

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/agentcontrol ./pkg/wshrpc/wshserver ./pkg/agentmcp ./cmd/wsh/cmd -count=1"` → `ok`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go build ./...; if ($LASTEXITCODE -eq 0) { echo BUILD_OK }"` → `BUILD_OK`
- [ ] `node scripts/verify/index.mjs --area agent-resume` → `12/12`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/agentcontrol -run TestBuildResumeBlockMetaParity -count=1"` → `ok`

## 记录

- 2026-11-21 建包（arch：touch 进 pkg/）。门链 G1(H)/G2/G5/G6(H)/G7(H)。
- 规划三件套：`.trellis/tasks/11-21-agent-resume/{prd,design,implement}.md`。
- 已知坑预登记：RPC 默认 timeout 8s 对 `--send` 组合不够（设计 §6 已注明 send 复用 AgentSendCommand 的等待窗口）。
