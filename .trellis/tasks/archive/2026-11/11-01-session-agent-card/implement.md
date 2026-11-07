# 实施清单：会话 agent card 读写

## 前置

- [ ] 读 `design/plans/agent-control-surface.md` §6.5 / §13 P0.1
- [ ] 读 `.trellis/spec/snorkeling-docs/backend/aisessions-title-contract.md`（titleSource 不变量）
- [ ] 确认 `live-session-overview` 的 `summary` 解析可复用

## 步骤

1. `pkg/aisessions/manager.go`：`ErrTitleProtected` + `SetAITitle(ctx, identifier, title, force)`。
   - 写 sqlite `SetAutoTitle`；必要时 meta 双写 `SetAutoTitle`；返回带 `TitleSource="ai"` 的 summary。
2. `pkg/aisessions/manager.go`：导出薄封装 `SetAIProps(ctx, identifier, suggestions, force)` =
   现有 `ApplyAIProperties`（若签名已够用则直接调用，不加新函数）。
3. `pkg/agentdata/patch.go`：
   - `PatchOperation` 增加 `Props map[string]PropPatch`、`Force bool`。
   - `PropPatch{Type string; Value any}`。
   - `allowedFieldsForOperation` / `validateOperation` / `previewOperation` / `applyOperation` 两个新 op。
   - 错误哨兵 → `E_CONFLICT` 映射（`OperationReport.Status`）。
4. `cmd/wsh/cmd/wshcmd-agent-card.go`：
   - `get`：summary + hash + persona(null)；`--json`。
   - `set`：flag 解析 → 自动 `get` 拿 hash（若未给）→ 组装 patch → dry-run/apply。
   - 人类可读 diff 输出（before → after）。
5. `cmd/wsh/cmd/wshcmd-agent.go`：挂载 `card` 子命令。
6. `pkg/agentcap/agentcap.go`：schema/examples/guide 增补两个 op。
7. `docs/project/agent-data-patch.md`：文档增补。
8. 单测 + `task generate`。

## 验证命令

```bash
go build ./...
go test ./pkg/agentdata/... ./pkg/aisessions/... ./cmd/wsh/cmd/...
```

## 真机验收

```bash
wsh agent card get this --json
wsh agent card set this --note "整理完成" --tags-add 已整理 --dry-run
wsh agent card set this --note "整理完成" --tags-add 已整理 --yes
wsh agent card set this --title "ACS 设计" --dry-run          # 期望 E_CONFLICT
wsh agent card set this --title "ACS 设计" --force --yes
wsh agent card set this --prop 优先级=P1 --dry-run            # 期望 skipped 说明
wsh data backup list --format summary
tail -1 <userdata>/agent-data/audit/patch-audit.jsonl
```

## 回滚点

- 新 op 是增量；回滚 = revert commit（已写的会话卡数据不回滚，属用户数据）。
- 若 `SetAITitle` 破坏 title 不变量，先回滚该方法再排查（`go test ./pkg/aisessions/` 有专门断言）。

## Review Gate

- [ ] 不存在绕过 agentdata 的直写路径
- [ ] titleSource 不变量测试通过
- [ ] `session_note.update` 现有 golden 未变
- [ ] dry-run 不产生任何写
