# PRD：本地 Agent 命令探测改用登录 Shell PATH（补候选目录含 opencode）

## 背景与问题

New Agent 面板的 agent 列表不是写死的，而是逐个 `FindCommand` 探测命令是否存在后过滤渲染的
（`frontend/app/workspace/widgets.tsx` → `getAgentProfileOptions` → `isDetectedAgentProfile`）。

而本地探测 `ClientService.FindCommand`（`pkg/service/clientservice/clientservice.go:54`）只有：

```go
path, err := exec.LookPath(command)
```

它吃的是 **wavesrv 进程自己的 PATH**。

### 实测证据（本机 macOS）

| 启动方式 | wavesrv 进程 PATH | 结果 |
|---|---|---|
| 终端 `npm run dev:electron` | 含 `~/.opencode/bin`、`~/.local/bin`、homebrew 等 | New Agent 正常显示 `Pi / Codex / Claude Code / OpenCode` |
| Finder/Dock 双击 `/Applications/Snorkeling.app`（launchd 启动） | `/usr/bin:/bin:/usr/sbin:/sbin` | 探测不到任何非系统目录的 agent |

macOS 的 GUI 应用由 launchd 启动，不加载 `~/.zshrc`，因此用户在 shell 里加的 PATH
（如 `export PATH=~/.opencode/bin:$PATH`）对 app 完全不可见。

### 已有的不对称

同一文件里，**远程**探测（`findCommandOnShellClient` → `makeFindCommandScript`）反而有一整套
写死的候选目录兜底：

```
~/.local/bin  ~/bin  ~/.npm-global/bin  ~/.bun/bin  ~/.cargo/bin
/opt/homebrew/bin  /usr/local/bin
```

也就是说：远程连接比本地更健壮。而且这套兜底列表**本身也缺 `~/.opencode/bin`**——opencode
官方安装器的默认目录。

## 复现步骤

1. 从 Finder/Dock 启动打包版 Snorkeling（PATH 为 launchd 的裸 PATH）。
2. 本机已安装 opencode（`~/.opencode/bin/opencode`）且能正常运行。
3. 打开 New Agent 面板 → 列表里没有 OpenCode（同目录安装的 codex/claude/pi 也一样漏）。

## 目标

1. 本地 `FindCommand` 在 `exec.LookPath` 失败后，回退到与远程一致的候选目录扫描。
2. 候选目录列表成为**单一事实来源**，本地与远程共用，并补齐 `~/.opencode/bin`。
3. 额外尝试解析登录 shell 的 PATH（带超时 + 缓存），覆盖用户自定义 PATH。
4. 不论从终端还是 GUI 启动，New Agent 都能探测到装在 homebrew / `~/.local/bin` /
   `~/.opencode/bin` 的 agent。

## 非目标

- 不改变 agent 的启动方式（只改“是否探测到”）。
- 不改前端过滤逻辑（`getAgentProfileOptions` 保持原样）。
- 不处理 OpenCode 会话 schema 漂移（那是 `10-26-opencode-provider-scan-fix`）。
- 不持久化修改用户机器的 PATH / launchctl 配置。

## 验收标准

- [ ] `FindCommand("opencode")` 在 PATH 不含 `~/.opencode/bin`、但该目录下存在可执行文件时返回其绝对路径。
- [ ] 候选目录列表包含 `$HOME/.opencode/bin`、`$HOME/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin`。
- [ ] `makeFindCommandScript` 生成的远程脚本与本地候选目录来自同一份列表。
- [ ] 登录 shell PATH 解析失败/超时不影响主流程（best-effort，返回空即跳过）。
- [ ] `go test ./pkg/service/clientservice/...` 通过。
- [ ] 不引入启动阻塞：登录 shell 解析只做一次并缓存，且有超时上限。

## 风险与边界

- 启动时解析登录 shell 可能较慢（`.zshrc` 内容多），必须缓存 + 超时（建议 ≤3s），失败静默。
- `-i`（交互 shell）在无 TTY 下可能有告警，只能读 stdout，不能依赖 stderr。
- Windows 无 POSIX shell，登录 shell 解析直接跳过，仅走候选目录。
- fish 的 `$PATH` 是列表类型，不能用 `printf "%s" "$PATH"` 拼接；统一改为执行 `env` 解析 `PATH=` 行。
