# A5 执行计划

## Step 1 后端纯逻辑

- [x] 1.1 `pkg/persona/sync.go`：`EnsureRootGitignore` / `SyncInit` / `SyncStatus` / `SyncPull` / `SyncPush` / `RebuildGenerated` / `MergeJournalTexts` / `MergeJournalNote` / `NormalizeSyncMode` / `SetSyncMode`
- [x] 1.2 生成物复用 `plannedFiles` 的 GENERATED 白名单（不复制模板）

## Step 2 CLI

- [x] 2.1 `persona sync init|status|pull|push|rebuild`，`--json` 走既有 `writeJSONObj`
- [x] 2.2 `agentguide` / skill 参考命令同步（若生成器需要）

## Step 3 测试

- [x] 3.1 `sync_test.go`：gitignore 幂等 / work 变更 status 为空 / rebuild 不碰人写文件 / 冲突双留 / sync.mode 校验与保留
- [x] 验证：`go test ./pkg/persona/ -run TestSync -v`

## Step 4 收尾

- [x] docs/project/persona-system.md §10、spec（如需）、commit、loop verify/accept

## touch 白名单

`pkg/persona/**`、`cmd/wsh/cmd/wshcmd-persona.go`、`pkg/agentguide/**`、`pkg/agentskill/content/**`、
`docs/project/persona-system.md`、`.trellis/tasks/11-12-persona-sync/**`、`.trellis/spec/**`、`loop/**`
