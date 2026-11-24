# Agent 块本机启动命令解析：GUI 裸 PATH 下 opencode 等 agent 找不到命令

## Goal

本机（非远程连接）创建 agent 块时，把裸命令名（如 `opencode`）解析为绝对路径后再写进 block meta，消除「弹窗探测得到、启动却 zsh: command not found」的不对称。

## 背景与根因（2026-11-24 实测）

- 用户 opencode 安装在 `~/.opencode/bin/opencode`，仅 `.zshrc` 把它加入 PATH。
- **弹窗能显示 OpenCode**：`FindCommand` RPC（`pkg/service/clientservice/clientservice.go`）有 `candidateDirSpecs` 回退扫描（含 `~/.opencode/bin`），探测链路能找到。
- **启动报错**：`resolveAgentBlockCommandForLaunch`（`frontend/app/workspace/agent-launch.ts:1145`）只在 `isRemoteExecutionConnection` 时解析；本机把裸 `opencode` 写进 meta。Go 端 `StartLocalShellProc`（`pkg/shellexec/shellexec.go:866`）对 cmd 块用 `zsh -c <cmd>` 且 `ecmd.Env = os.Environ()`——GUI 启动的进程 PATH 是 launchd 裸 PATH，不含 `~/.opencode/bin` → `zsh:1: command not found: opencode`（exit 127）。
- 用户外部终端正常，因为交互 zsh 读了 `.zshrc`。

## Requirements

- **R1 本机解析（核心）**：`resolveAgentBlockCommandForLaunch` 对本机连接（null / `local` / `local:*`）也调用命令解析（`FindCommand`），解析成功且通过守卫时用绝对路径替换 meta.cmd。
- **R2 守卫（保守替换）**：
  - 解析结果为空 → 保留裸 cmd 原样（不 throw、不阻断建块；弹窗层已用同一探测过滤没装的 agent，此为兜底一致性）。
  - 解析结果含空格 → 保留裸 cmd（`shellcontroller.go:1013` 对 `cmd:shell=false` 的 cmd 禁止空格）。
  - Windows `.cmd`/`.bat`/`.ps1` shim → 保留裸 cmd（Windows GUI 进程 PATH 来自注册表，通常本就可用；本任务主战场 macOS/Linux）。
  - 远程连接行为完全不变（解析失败仍 throw，含现有错误文案）。
- **R3 四个本机创建面全部收口**（不得出现第五份实现）：
  1. widgets.tsx New Agent 各入口（已走 `prepareAgentBlockDef`，放开 R1 即覆盖）。
  2. `session-overview.tsx` `submitAddAgent`（~3059）与 new-tab-with-agent（~3114）——当前完全未解析。
  3. `hero-launch.ts` `buildHeroLaunchBlockDef`（~162）——当前完全未解析。
  4. 后端 `pkg/wshrpc/wshserver/agentlaunch.go`（定时任务建 agent 块，meta 写裸 `profile.Cmd`）——Go 侧用 `candidateDirSpecs` 同源逻辑解析。
- **R4 单一收口**：前端解析守卫逻辑只写一份（agent-launch.ts 内），调用方只传 resolver。

## Acceptance Criteria（命令 → 期望输出）

- [ ] `npm run test -- agent-launch`（前端 vitest，agent-launch 相关用例）全绿，其中新增用例：
  - local + resolver 返回 `/Users/x/.opencode/bin/opencode` → `meta.cmd === "/Users/x/.opencode/bin/opencode"`；
  - local + resolver 返回 `""` → `meta.cmd` 保持裸 `"opencode"`（不抛错）；
  - local + resolver 返回含空格路径 → `meta.cmd` 保持裸 cmd；
  - local + resolver 返回 `C:\...\opencode.cmd` → 保持裸 cmd；
  - remote 用例行为不变（既有断言）。
- [ ] `go test ./pkg/wshrpc/... ./pkg/service/clientservice/...` 全绿；agentlaunch.go 单测断言本机 + `~/.opencode/bin` 场景下 meta.cmd 为绝对路径。
- [ ] 真机（GUI 启动的 Snorkeling）：New Agent → OpenCode 建块，块内进程正常启动，无 `zsh:1: command not found`；block meta 的 cmd 为绝对路径（`node scripts/inspect-electron-ui.mjs` 或 `wsh` 查证）。Overview add-agent 建的 OpenCode 块同样能启动。
- [ ] 回归：pi / codex / claude 本机启动不受影响（cmd 均在 GUI PATH 或 `/opt/homebrew/bin`，替换后路径不含空格，行为等价）。

## Notes

- 2026-11-24 已单独修复机器侧问题：codex npm 安装损坏（缺 `@openai/codex-darwin-arm64` + bin 链接丢失），已 `npm install -g @openai/codex@latest` 修复至 0.172.0——那是环境问题，与本任务代码修复无关但同日发生，勿混淆。
- `getAgentProvider`（shellcontroller.go:1096）取 cmd 的 basename 判 provider，绝对路径安全；且建块时已写入 `agent:provider` meta。
