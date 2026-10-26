# Design — Terminal Block Redraw TUI + Restart 移入菜单

## 1. 目标行为

| 状态 | Header 默认按钮 | ⋯ 菜单 |
|---|---|---|
| init（未启动） | ▶ Start（现有 `forceRestartController` 语义，仅启动） | Restart Shell/Agent（确认后） |
| running | ↻ Redraw TUI（纯重绘） | Restart Shell/Agent（确认后） |
| done（已退出） | ↻ Redraw TUI（纯重绘，含 xterm 缓冲区重绘） | Restart Shell/Agent（确认后） |

- Redraw 绝不调用 `ControllerDestroyCommand` / `ControllerResyncCommand(forcerestart)`。
- Restart 复用现有 `forceRestartController()`，但必须先经确认弹窗。

## 2. 架构

```
[Header ↻]  click
   └─ TermViewModel.redrawTUI()
        ├─ 前端层：(termRef.terminal).refresh(0, rows-1)   # xterm 画布/缓冲区重绘
        └─ 后端层：RpcApi.ControllerRedrawCommand(blockId)  # fire-and-forget
              └─ wshrpc "controllerredraw" (new, Call, BlockRpcClient)
                    └─ WshServer.ControllerRedrawCommand(ctx, blockId)
                          └─ blockcontroller.RedrawController(ctx, blockId)
                                └─ type-assert { RedrawTUI() error }
                                      └─ ShellController.RedrawTUI()
                                            └─ SIGWINCH → 前台进程组(本地)
```

## 3. 后端

### 3.1 RPC 声明（反射自动注册，无需手动注册表）

`pkg/wshrpc/wshrpctypes.go` — `BlockRpcClient` interface 增加：

```go
ControllerRedrawCommand(ctx context.Context, blockId string) error
```

（签名与 `ControllerDestroyCommand(ctx, blockId string)` 一致；命令名由方法名推导为 `controllerredraw`，Call 类型。）

### 3.2 wshserver handler

`pkg/wshrpc/wshserver/wshserver.go`：

```go
func (ws *WshServer) ControllerRedrawCommand(ctx context.Context, blockId string) error {
    ctx = genconn.ContextWithConnData(ctx, blockId)
    ctx = termCtxWithLogBlockId(ctx, blockId)
    return blockcontroller.RedrawController(ctx, blockId)
}
```

### 3.3 blockcontroller 分发

`pkg/blockcontroller/blockcontroller.go`：

```go
// redrawable 由支持 TUI 重绘的 controller 实现
type redrawableController interface { RedrawTUI() error }

func RedrawController(ctx context.Context, blockId string) error {
    ctrl := getControllerForBlock(blockId) // 复用现有查找逻辑
    if ctrl == nil { return nil }          // 无 controller：安全 no-op（前端 xterm 重绘仍生效）
    rc, ok := ctrl.(redrawableController)
    if !ok { return nil }                  // 不支持的 controller：no-op，不报错
    return rc.RedrawTUI()
}
```

> `getControllerForBlock` 按现有 `ControllerResyncCommand` 的查找方式实现（无则 no-op，不失败）。

### 3.4 ShellController.RedrawTUI()

`pkg/blockcontroller/shellcontroller.go` 新增方法：

```go
func (sc *ShellController) RedrawTUI() error {
    sc.Lock.Lock(); defer sc.Lock.Unlock()
    sp := sc.ShellProc
    if sp == nil || sp.Cmd == nil { return nil }   // 无运行进程：no-op
    pid := shellProcPid(sp)                          // 本地 CmdWrap→exec.Cmd.Process.Pid；远程无 pid→0
    if pid <= 0 { return nil }
    if pgid, err := unixutil.GetProcessGroupId(pid); err == nil && pgid > 0 {
        if err := syscall.Kill(-pgid, syscall.SIGWINCH); err == nil { return nil }
    }
    // 进程组不可用时的兜底：直接向 pid 发 SIGWINCH（绝不 Kill）
    _ = unixutil.SendSignalByName(pid, "SIGWINCH")
    return nil
}
```

**信号目标**：优先发进程组 `-pgid`（等价于 PTY 真实 resize 时内核给前台进程组广播 SIGWINCH），确保 agent TUI 及其子进程都收到；进程组失败则回退直接向 pid 发 `SIGWINCH`（新增 `unixutil.SendSignalByName(pid, "SIGWINCH")` 已存在）。

**远程连接（v1 边界）**：远程 ShellProc 由 wshrpc 代理，本机无 pid 可发。v1 对远程块返回 no-op，仍会执行前端 xterm 层重绘；远程 SIGWINCH 代理作为后续改进（走 `CommandRemoteProcessSignalData` 现有 remote 路由）。

**Windows**：`unixutil.SendSignalByName` 在 Windows 上返回 "signal not supported" → RedrawTUI 捕获后 no-op，不影响前端重绘。

## 4. 前端

### 4.1 RpcApi

`frontend/app/store/wshclientapi.ts` 增加（mode 既有模式）：

```ts
// command "controllerredraw" [call]
ControllerRedrawCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
    if (this.mockClient) return this.mockClient.mockWshRpcCall(client, "controllerredraw", data, opts);
    return client.wshRpcCall("controllerredraw", data, opts);
}
```

`frontend/types/gotypes.d.ts` 无需新增类型（blockId 为 string，与 destroy 一致）。

### 4.2 TermViewModel.redrawTUI()

`frontend/app/view/term/term-model.ts` 新增：

```ts
redrawTUI() {
    const terminal = this.termRef.current?.terminal;
    if (terminal) {
        try {
            terminal.refresh(0, terminal.rows - 1); // xterm 缓冲区/画布重绘
        } catch {}
    }
    fireAndForget(() =>
        RpcApi.ControllerRedrawCommand(TabRpcClient, this.blockId).catch(() => undefined)
    );
}
```

### 4.3 endIconButtons 改造

改 `endIconButtons` atom（约 line 420-460）：

| 状态（现状 → 新） | icon | title | click |
|---|---|---|---|
| init | play（不变） | "Click to Start Shell/Command" | `forceRestartController`（不变，仅启动） |
| running | refresh（不变） | "Redraw TUI"（新） | `redrawTUI`（新） |
| done | refresh（不变） | "Redraw TUI"（新） | `redrawTUI`（新） |

移除旧的 "Running. Click to Restart" / "Exited. Click to Restart" tooltip。

### 4.4 Restart → ⋯ 菜单 + 确认弹窗

`getSettingsMenuItems()`（term-model.ts）：
- 在顶级菜单（classic menu items 之后、"Advanced" 之前）新增：
  - label：`Restart Shell`（普通）/ `Restart Agent Session`（`isAgentTerminalMeta(meta)` 时）
  - click：`modalsModel.pushModal("RestartConfirmModal", { blockId, isAgent, onConfirm })`
- 删除 Advanced 子菜单里的 `Force Restart Controller` 项（消除未经确认的重启路径与重复项）。

**新组件** `frontend/app/modals/restartconfirmmodal.tsx`（仿 `CloseTabModal` 的 FlexiModal 模式）：

```tsx
function RestartConfirmModal({ blockId, isAgent, onResolve }: {
    blockId: string;
    isAgent: boolean;
    onResolve: (restart: boolean) => void;
}) { /* Cancel / Restart 按钮；Restart → onResolve(true) */ }
RestartConfirmModal.displayName = "RestartConfirmModal";
```

文案：
- 普通：`重启 Shell 会终止当前运行的命令并重新启动它。确定？`
- Agent：`重启 Agent 会话会中断当前运行（启用 autoresume 时可恢复原会话）。确定？`

确认后 → `modalsModel.popModal()`；`fireAndForget(() => viewModel.forceRestartController())`。

注册：`frontend/app/modals/modalregistry.tsx` 添加 `RestartConfirmModal`。

> 不需要把确认逻辑放进 `forceRestartController` 本身，避免影响其它内部调用（如耐久会话重启、Enter 重启动线）。

## 5. 兼容性

- 现有 `forceRestartController` 保持原样，被如下位置继续引用：init Start、Enter 键重启动线（term-model keydown）、RestartConfirmModal 确认路径。
- “Redraw”不改变 controller 生命周期，session/resume 协议完全不受影响。
- 无线程/时序改动；RPC fire-and-forget 失败静默。

## 6. 测试

### 后端 Go（pkg/blockcontroller）
- `TestRedrawController_NoController`：无 controller → nil，不 panic。
- `TestRedrawController_UnsupportedController`：不可 redraw 的 controller → nil no-op。
- `TestShellControllerRedrawTUI_NoProc`：ShellController 无进程/无 Cmd → nil，不发信号。
- `TestShellControllerRedrawTUI_SendsSigwinch`（可注入 proc 时）：有运行进程 → 向进程组/pid 发 SIGWINCH；用可替换 signal sender 隔离（若现有结构不便注入，则降级为只验证 no-op 分支 + Redraw 不调用 destroy/resync 的回归断言）。

### 前端（vitest）
- `term-model endIconButtons`：done/running 状态下 tooltip 为 Redraw TUI、click 走 redrawTUI 而非 forceRestartController；init 保持 Start。
- `RestartConfirmModal`：渲染 Cancel/Restart；Cancel 不触发重启回调；Restart 触发。