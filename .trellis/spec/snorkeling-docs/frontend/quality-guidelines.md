# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Terminal Block 轻量操作约定 (2026-10-15, task 10-15)

- Header 右上角默认按钮应承载**轻量、高频、无害**操作（如 `Redraw TUI`），不要直接暴露会中断进程的重操作。
- 会中断进程/会话的操作（如 `Restart Shell/Agent`）移入“⋯”菜单，并先经确认弹窗（`RestartConfirmModal`）。
- 新增后端 RPC 时需要同步三处：`pkg/wshrpc/wshrpctypes.go`（接口方法，反射自动注册）、`pkg/wshrpc/wshclient/wshclient.go`（Go client）、`frontend/app/store/wshclientapi.ts`（前端 RpcApi，含 mock 分支）。
- 终端重绘不动进程：前端 `terminal.refresh(0, rows-1)` + 后端对进程组发 SIGWINCH（`unixutil.SignalGroupByName`）；绝不调用 `ControllerDestroyCommand`/`ControllerResyncCommand(forcerestart)`。
- 信号工具优先放 `pkg/util/unixutil`（unix/windows 双实现），不要在业务层直接 `syscall.Kill`。

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
