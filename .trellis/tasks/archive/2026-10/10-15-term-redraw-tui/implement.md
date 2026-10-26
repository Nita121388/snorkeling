# Implement — Terminal Block Redraw TUI + Restart 移入菜单

## 顺序与检查点

### 0. 准备
- [x] 从当前 HEAD 建独立分支 `feat/term-redraw-tui`（`task.py set-branch`）。
- [x] 确认 `.trellis/tasks/10-15-term-redraw-tui/` 的 prd/design 已就绪。

### 1. 后端 RPC（Go）
- [x] `pkg/wshrpc/wshrpctypes.go`：`BlockRpcClient` 加 `ControllerRedrawCommand(ctx, blockId string) error`。
- [x] `pkg/blockcontroller/blockcontroller.go`：`redrawableController` 接口 + `RedrawController(ctx, blockId)` 分发（无 controller / 不支持 → no-op nil）。
- [x] `pkg/blockcontroller/shellcontroller.go`：`ShellController.RedrawTUI()`（进程组 SIGWINCH，兜底 pid SIGWINCH，无进程 no-op，绝不 Kill/Destroy）。
- [x] `pkg/wshrpc/wshserver/wshserver.go`：`ControllerRedrawCommand` handler（带 ctx conn/log 包装）。
- [x] `pkg/wshrpc/wshclient/wshclient.go`：client wrapper `ControllerRedrawCommand`（命令名 `controllerredraw`）。
- [x] 检查点：`go build ./pkg/...` + `go vet ./pkg/blockcontroller ./pkg/wshrpc/...`

### 2. 后端测试
- [x] `pkg/blockcontroller/redraw_test.go`（或并入现有 test 文件）：
  - 无 controller → nil；不支持 RedrawTUI 的 controller → nil；
  - ShellController 无进程 → nil 不发信号；
  - 有进程（mock/注入）→ 发 SIGWINCH 到进程组（或验证不调用 destroy/resync）。
- [x] 检查点：`go test ./pkg/blockcontroller/... ./pkg/wshrpc/...`

### 3. 前端 RPC 与 Redraw
- [x] `frontend/app/store/wshclientapi.ts`：`ControllerRedrawCommand`（`mockWshRpcCall` 分支同现有模式）。
- [x] `frontend/app/view/term/term-model.ts`：新增 `redrawTUI()`（`terminal.refresh(0, rows-1)` + fire-and-forget RPC，catch 静默）。
- [x] `endIconButtons`：running/done → icon refresh + tooltip `Redraw TUI` + click `redrawTUI`；init 保持 play/Start。
- [x] 检查点：`npm run typecheck`（或 `npx tsc --noEmit`）+ 现有 term 相关 vitest 不回归。

### 4. Restart → ⋯ 菜单 + 确认弹窗
- [x] `frontend/app/modals/restartconfirmmodal.tsx`：FlexiModal 确认组件（Cancel/Restart，仿 CloseTabModal），displayName `RestartConfirmModal`。
- [x] `frontend/app/modals/modalregistry.tsx`：注册 `RestartConfirmModal`。
- [ ] `term-model.ts getSettingsMenuItems()`：顶级加 `Restart Shell` / `Restart Agent Session`（`isAgentTerminalMeta` 区分），click 打开确认弹窗；删除 Advanced 下的 `Force Restart Controller`（避免无确认路径 + 重复）。
- [x] 检查点：`npm run typecheck` + 菜单相关 vitest。

### 5. 前端测试
- [x] `term-model` 单测：done/running 的 endIconButtons → Redraw TUI tooltip + click 调 redrawTUI（mock RpcApi/termRef），init 保持 Start；Restart 菜单项存在且 click 打开确认弹窗（mock modalsModel）。
- [x] `restartconfirmmodal.test.tsx`：Cancel 不回调重启；Restart 回调。
- [x] 检查点：`npx vitest run <相关文件>` 全绿。

### 6. 手动验证（Electron，可选）
- [ ] 运行 app（CDP port 9222）：
  - 开一个 agent/term block，缩小放大窗口制造显示不全 → 点 header ↻ → TUI 重绘、进程 PID 不变。
  - ⋯ 菜单 Restart → Cancel 无变化；Confirm 后进程重启。
- [ ] 远程 terminal block：Redraw 静默 no-op 不报错。

### 7. 收尾
- [ ] `git status` 仅含本任务相关改动；提交（含 `.trellis/tasks/10-15-*` 规划产物）。
- [ ] `task.py start` 已执行；实现完成后按 Phase 3 收尾（3.3 spec 更新、3.4 commit）。

## 验证命令

```bash
go build ./pkg/... && go vet ./pkg/blockcontroller ./pkg/wshrpc/...
go test ./pkg/blockcontroller/... ./pkg/wshrpc/...
npm run typecheck
npx vitest run frontend/app/view/term frontend/app/modals
```

## 风险与回滚

- **风险**：SIGWINCH 对个别 TUI 无效 → Redraw 退化为仅前端 xterm 重绘，仍无害；用户仍可用菜单 Restart。
- **风险**：确认弹窗阻塞高频操作 → 仅 Restart 加确认，Redraw 无弹窗，保持轻量。
- **回滚**：所有改动集中在上述文件；整任务 revert 即可，无数据/会话迁移。