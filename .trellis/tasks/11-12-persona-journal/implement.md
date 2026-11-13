# A6 执行计划

## Step 1 纯逻辑
- [x] 1.1 `pkg/persona/journal.go`：AppendJournal / ListInbox / ApproveInbox / DismissInbox
- [x] 1.2 `pkg/persona/distill.go`：Distill / UndoDistill / TL;DR 维护

## Step 2 CLI
- [x] 2.1 `persona journal append` / `memory inbox|approve|reject` / `distill`
- [x] 2.2 agentguide + skill 参考同步

## Step 3 测试
- [x] 3.1 journal 格式/状态、inbox 解析/批准/驳回/幂等、蒸馏去重+覆盖率+undo
- [x] 验证：`go test ./pkg/persona/ -run 'TestJournal|TestInbox|TestDistill' -v`

## Step 4 收尾
- [x] docs §11、commit、loop verify/accept

## touch 白名单
`pkg/persona/**`、`cmd/wsh/cmd/wshcmd-persona.go`、`pkg/agentguide/**`、`pkg/agentskill/content/**`、
`docs/project/persona-system.md`、`.trellis/tasks/11-12-persona-journal/**`、`.trellis/spec/**`、`loop/**`
