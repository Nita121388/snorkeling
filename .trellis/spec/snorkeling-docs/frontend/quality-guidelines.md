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

## Agent 块拆分 = 新会话（2026-10-22, task 10-22-agent-split-new-session）

- 拆分（水平/垂直）一个 Agent 块时，新块起**全新会话**，不 resume 源块会话。改写落点唯一：
  `frontend/app/store/global.ts` 的 `createBlockSplitHorizontally` / `createBlockSplitVertically`
  套 `buildSplitBlockDef`（`frontend/app/workspace/agent-split.ts`）。
- 任何"拿已有 block meta 去开新块"的路径都要先问一句：**这份 meta 是不是带 agent 身份**
  （`agent:autoresume` / `agent:provider` / `agent:sessionid`）。带 → 剥会话身份再开新块。
  整份复制 meta 会把 `agent:sessionid` 一起带走，后端据此给新块拼 resume → 两个块共用一个会话。
- 剥会话身份 = 删 `agent:sessionid` + 剥 `cmd:args` 里的 resume 参数；**其余 meta 全留**
  （provider / 模型 / vendor / cwd / connection / `agent:autoresume`），新块才是"同配置的新会话"。
- **不要动** `createBlock` / `replaceBlock`：`restoreMetaForSession` 等「用户主动打开某个会话」的
  路径走 `createBlock`，必须保留 resume 语义。
- 完整跨层契约见 [Agent 会话 resume 契约](../backend/agent-session-resume-contract.md)。

---

## 设置面板：unset ≠ false，默认值在 TS 层 (2026-10-22, task 10-22-agent-os-notify-denoise)

- Go `SettingsType` 的开关字段是 `*bool` / `*int64`，**“未设置”与“false/0”是两个意思**：
  未设置 → 用默认值；显式存了 `false`/`0` → 必须用 `false`/`0`。
  读设置一律用 `??` 回落默认值，**禁止用 `||`**（`||` 会把显式 `false` 覆盖成默认 `true`）。
- 默认值集中在 `frontend/util/sharedconst.ts`，主进程（`emain/` 通过 `@/util/...` 引用）与
  设置面板同源。**Go 侧不要给这些字段填默认值**——那会把 `false` 和“未设置”合并成一个意思。
- 写 `settings.json` 走 `RpcApi.SetConfigCommand`：Go 侧 `SetBaseConfigValue` 是**合并**写入，
  只替换传入的键，其余键原样保留；未知键会被 `getConfigKeyType` 拒绝并报错。
  因此新增设置键时，键名必须与 Go 的 json tag 完全一致（见 backend 契约文档的必测项）。
- 完整契约见 [Agent OS 通知抑制契约](../backend/agent-os-notify-contract.md)。

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
