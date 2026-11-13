> **Confirmed: 2026-11-13 @nita**

# A6 journal 写入器 + 提议制记忆 + 蒸馏

> 用户 2026-11-13 会话授权：「继续开发直到完成」；「暂时不用真机验证，最后我手动验证」。
> 判据全部纯机器可判定（Go 测试 / 构建 / 探针），不跑 Electron 真机台。

## Goal

让人设「记得住」：当班自动留痕、教训提议入档、记忆过厚可蒸馏且可回滚。

## Requirements

- journal 写入器：当班结束（或 supervisor 轮次）写 `<id>/.persona/MEMORY/journal.md`（时间戳 + 状态 + 一句摘要 + 来源）；机器区，agent 可直写
- 提议制：解析 A2.5 生成的 `MEMORY/inbox.md` 结构化块（pending）；批准 → 追加目标文件（facts/lessons/CHARTER）+ 标记 approved + journal 记录；驳回 → 标记 dismissed 保留；幂等
- 蒸馏：facts/lessons 条目超阈值 → 去重合并、维护 facts 头部 `## TL;DR` ≤5 条；写前备份可 `--undo` 回滚；覆盖率 100%（非重复条目零丢失）
- CLI：`persona journal append` / `persona memory inbox|approve|reject` / `persona distill`

## Acceptance Criteria

- [ ] `go test ./pkg/persona/... ./pkg/service/aisessionsservice/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `go test ./pkg/persona/ -run TestJournal -v` → 含 `PASS`
- [ ] `go test ./pkg/persona/ -run TestInbox -v` → 含 `PASS`
- [ ] `go test ./pkg/persona/ -run TestDistill -v` → 含 `PASS`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`
- [ ] `grep personaJournalCmd cmd/wsh/cmd/wshcmd-persona.go` → 含 `personaJournalCmd`

## 依赖

A1（scaffold / MEMORY 目录）、A2.5（inbox 提议格式）、A3（当班生命周期）、A5（sync rebuild，不改）。

## 假设与偏离（自主决策）

1. 蒸馏 v1 = 显式 `wsh persona distill --yes` 的纯 Go 去重 + TL;DR 维护 + 备份回滚；
   不接前端 AutoGenerate RPC / 后台 worker（记忆写在磁盘，CLI 是唯一写路径，接 RPC 会多一份事实来源）。
2. inbox 结构复用 A2.5 的 `## <ts> <section> propose` 四行块；旧块缺 `- 状态:` 视为 pending（向后兼容）。
3. 批准是**人的动作**：CLI 要求 `--yes`，agent 无自动批准入口（沿用 propose 闸门）。
4. 真机验证留用户手动。
