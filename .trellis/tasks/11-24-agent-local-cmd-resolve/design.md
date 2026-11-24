# 技术设计：Agent 块本机启动命令解析

## 现状链路（不对称的根因）

```
探测（弹窗显示）:  useDetectedAgentProfileOptions → FindCommand RPC
                  → exec.LookPath 失败 → candidateDirSpecs 回退扫描（含 ~/.opencode/bin）
                  → login-shell PATH 兜底 → 找到 ✓

启动（建块）:      createAgentBlockDefForProfile/ForTarget → meta.cmd = 裸 "opencode"
                  → resolveAgentBlockCommandForLaunch 只对 isRemoteExecutionConnection 解析
                  → 本机原样落 meta
                  → Go StartLocalShellProc: zsh -c "opencode ..."，ecmd.Env = os.Environ()
                  → GUI 裸 PATH → zsh:1: command not found ✗
```

## 方案：放开本机解析 + 守卫替换 + 四面收口

### 1. 前端核心（agent-launch.ts）

`resolveAgentBlockCommandForLaunch(blockDef, resolveCommand)` 改为：

```
connection = normalizeConnection(meta.connection)
if isBlank(cmd): return blockDef          // 现状不变
resolved = await resolveCommand(cmd, connection, cwd).trim()
if isRemoteExecutionConnection(connection):
    // 现状逻辑原样保留：空 → throw；否则替换
if 本机:
    if 通过守卫(resolved): 替换 meta.cmd = resolved
    else: return blockDef 原样（含 resolved 为空）
```

守卫（单一函数 `shouldUseLocalResolvedCmd`）：

- `resolved` 为空 → false
- `resolved` 含空格 → false（`shellcontroller.go:1013`：`cmd:shell=false` 禁止空格）
- `resolved` 以 `.cmd` / `.bat` / `.ps1` 结尾（Windows shim）→ false
- 其余 → true（macOS/Linux 绝对路径、Windows 无空格 `.exe`）

`resolveCommand` 回调沿用 widgets.tsx 现有 `FindCommandForConnection(command, connection, cwd)`——本机（connName 空/`local`）后端自动走 `FindCommand` 含回退扫描，无需新 RPC。

### 2. 前端调用面补齐

| 面 | 现状 | 改法 |
|---|---|---|
| widgets.tsx New Agent（当前 Tab/新 Tab/既有 Tab/launchAgentTarget） | 已走 `prepareAgentBlockDef` | 放开 R1 自动覆盖，零改动 |
| session-overview.tsx `submitAddAgent`（~3059） | 未解析 | 建块前过 `resolveAgentBlockCommandForLaunch`（用同一 `env.services.client.FindCommandForConnection`） |
| session-overview.tsx new-tab-with-agent（~3114） | 未解析 | 同上 |
| hero-launch.ts `buildHeroLaunchBlockDef`（~162） | 未解析 | 调用方（确认 hero 启动入口能拿到 services.client）注入 resolver；若该函数为纯函数无法访问 client，则在其调用点解析 |

注意：gui chat 块（pi gui 模式，`createGuiChatBlockDef`）不走 cmd controller，**不在**本任务范围，保持现状。

### 3. 后端（agentlaunch.go）

定时任务建 agent 块在 wsh server 进程内直接写 `meta[MetaKey_Cmd] = profile.Cmd`，同样吃 GUI 裸 PATH。

- 导出 clientservice 的回退扫描为 `clientservice.ResolveLocalCommand(command string) string`（`resolveCommandWithFallback` 已存在，加薄导出层；`candidateDirSpecs` 保持单一来源）。
- `agentlaunch.go` 建 meta 处：本机（`data.Connection` 空/`local`）时 `resolved := clientservice.ResolveLocalCommand(profile.Cmd)`，套用与前端相同的守卫（空/空格/shim 后缀 → 保留裸 cmd）。
- 远程（`data.Connection` 非空）定时任务建块维持现状（远程解析另有链路，不在本任务扩大）。

### 4. 数据流不变项（安全论证）

- `cmd:args` / `cmd:env` / vendor 注入不因 cmd 替换变化。
- resume：`resolveAgentCmdAndArgs` → `getAgentProvider` 取 basename → 绝对路径下 provider 判定不变；且块创建时已持久化 `agent:provider` meta，优先读取。
- `isWindowsShimCommand`（远程 Windows）逻辑不动。

## 风险与回滚

- 风险面：路径含空格已守卫；Windows shim 已守卫；远端行为不变。剩余风险 = 用户自定义 profile 的 cmd 本身是脚本路径（含 `/`），`FindCommand` 对已限定路径原样返回（`resolveCommandWithFallback` 首行短路），不受影响。
- 回滚：前端 + 后端各一个独立 commit，`git revert` 即回滚；meta 已落盘的绝对路径块在回滚后仍可运行（绝对路径直接可执行）。

## 权衡记录

- 本机解析失败**不 throw**（与远程不同）：弹窗层已用同一探测源过滤，启动时解析失败属罕见竞态（如刚卸载），保留裸 cmd 与今天行为一致，不新增用户阻断点。
