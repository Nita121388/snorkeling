> **Confirmed: 2026-11-13 @nita**

# A5 跨机同步 v1（rootdir 单仓 + gitignore 清单）

> 用户 2026-11-13 会话授权：「继续开发直到完成」，并明确「暂时不用真机验证，最后我手动验证」。
> 故本包判据全部改为纯机器可判定（Go 测试 / 构建 / 探针），不跑 Electron 真机台。

## Goal

人设跟着人走：rootdir 本身是 git 仓库，clone 到新机器后一条命令重建生成物，登场即恢复记忆。

## Requirements

- `wsh persona sync init|status|pull|push|rebuild` 五个子命令（git 薄封装）
- rootdir 级 `.gitignore` 按设计 §3.2；`*.local.json` / `work/` / `agents/` / `AGENTS.md` / `.index/` 不入库
- 跨机 clone 后 `sync rebuild` 幂等重建：`.index/PERSONAS.md`、每人设 `.persona/agents/*.md`、根 `AGENTS.md`；
  **绝不覆盖** CHARTER / MEMORY / persona.json
- `persona.local.json: sync.mode = shared | own` 已有数据模型，v1 提供读写与校验
- journal 追加冲突：合并双方条目（去重、稳定排序），并在 `MEMORY/inbox.md` 留一条冲突提示，不静默丢

## Acceptance Criteria

- [ ] `go test ./pkg/persona/... ./pkg/service/aisessionsservice/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `go test ./pkg/persona/ -run TestSync -v` → 含 `PASS`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`
- [ ] `grep SyncModeShared pkg/persona/sync.go` → 含 `SyncModeShared`
- [ ] `grep personaSyncCmd cmd/wsh/cmd/wshcmd-persona.go` → 含 `personaSyncCmd`
- [ ] `go test ./pkg/persona/ -run TestSyncJournalConflict -v` → 含 `PASS`

## 依赖

A1（scaffold / roster / PersonaLocal.Sync）、A3（登场管线，本包不改）。

## 假设与偏离（自主决策）

1. `sync pull/push` 只做 git 薄封装，不自动处理 remote 未配置（报错给命令，由用户配 remote）。
2. 「clone 后首次登场自动重建」v1 由显式 `wsh persona sync rebuild` 提供；自动挂钩到登场留 A4 名册 Block。
3. journal 冲突合并为纯函数（两版文本 → 合并文本 + inbox 提示），CLI 在 `status` 检测到 unmerged 时提示跑 `rebuild`；不做 git merge driver 自动注册。
4. 真机验证全部留用户手动。
