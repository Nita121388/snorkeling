# Terminal Block 刷新按钮改为 Redraw TUI + Restart 移入更多菜单

## Goal

将 Terminal Block 右上角默认操作从“重启进程”改为轻量的 **Redraw TUI**：不关闭 shell/agent 进程，只重新刷新终端渲染并通知运行中的 TUI 重新绘制。将原本的重启操作移入 Terminal 的“更多”菜单，并保留明确的确认语义。

## Requirements

### Redraw TUI

- Terminal Block header 的默认按钮执行 Redraw TUI，而不是 `forceRestartController`。
- Redraw 不得调用 `ControllerDestroyCommand` 或带 `forcerestart` 的 `ControllerResyncCommand`。
- Redraw 应同时覆盖两层：
  - 前端终端缓冲区/画布重绘，修复 xterm 渲染或几何状态不同步；
  - 通知后端 PTY 中的前台 TUI 进程重新感知窗口尺寸并重绘，优先使用明确的 SIGWINCH/等价 resize 信号，而不是依赖用户手动改变窗口大小。
- Redraw 不得创建新 shell、agent 进程或新会话，不得丢失当前会话状态。
- 按钮 tooltip 必须明确表达“Redraw TUI/重绘界面”，不能继续使用“Restart”语义。

### Restart

- 原来的进程重启能力必须保留，但移入 Terminal 的“更多”菜单。
- Restart 继续复用现有的 controller 重启语义；不能被 Redraw 替代。
- Restart 菜单项文案必须明确是重启 shell/agent 进程。
- 触发 Restart 前显示确认提示，说明会中断当前进程；用户取消时不得改变 controller 或终端会话。
- Agent Block 的确认文案应说明具备 autoresume 时可能恢复原会话，但本次操作仍会中断当前运行。

### 状态与兼容性

- 未启动的 Terminal/Command 仍显示 Start/Play 语义，不应把未启动状态误标为 Redraw。
- 普通 Terminal、Agent Terminal 和远程 Terminal 都不能因为新增 Redraw 而破坏现有输入、resize、session resume 行为。
- 已退出进程的 Terminal 仍可通过“更多”菜单 Restart；Redraw 可安全执行，即使没有可发送 SIGWINCH 的运行进程。

## Acceptance Criteria

- [ ] 点击 header 的 Redraw TUI 后，运行中的 shell/agent 进程 PID、会话和 controller 不变。
- [ ] Redraw 能触发 xterm/终端缓冲区重绘，并通过现有或新增的后端路径通知 TUI 重新绘制。
- [ ] Agent TUI 在窗口尺寸不同步、显示不全的场景下可通过 Redraw 恢复显示，无需手动放大窗口。
- [ ] 点击“更多”菜单中的 Restart 后，确认前不会重启；取消确认后 controller 不变；确认后保持原有重启行为。
- [ ] init 状态仍提供 Start/Play 操作。
- [ ] Restart 和 Redraw 的 tooltip、菜单文案不会混淆两种行为。
- [ ] 为新增前后端行为补充针对性测试，并通过受影响包的 lint/typecheck/test 验证。

## Constraints

- 不改变 Agent 会话恢复协议本身；Redraw 不能通过 destroy/resync 间接实现。
- 优先复用已有 resize/PTY/IPC 能力；若新增 RPC，应保持远程连接路由兼容。
- 不能把进程 PID 暴露给前端作为长期 UI 状态，除非现有 RPC 架构明确要求；更优先由 block/controller 后端封装 Redraw 行为。
