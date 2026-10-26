# Agent 命令探测契约（本地 + 远程统一）

> 适用范围：New Agent 面板的 agent 列表、`ClientService.FindCommand` /
> `FindCommandForConnection`、以及任何依赖「这个 agent 命令在本机是否存在」的 UI。

## 背景：为什么不能只信 `exec.LookPath`

New Agent 面板的 agent 列表不是静态数组，而是逐个 `FindCommand(cmd)` 探测后过滤渲染的
（`frontend/app/workspace/widgets.tsx` → `getAgentProfileOptions` → `isDetectedAgentProfile`）。

macOS 的 GUI 应用由 launchd 启动，**不加载 `~/.zshrc`**，进程 PATH 只有
`/usr/bin:/bin:/usr/sbin:/sbin`。因此：

- 用户 shell 里 `export PATH=$HOME/.opencode/bin:$PATH` 对 app 不可见；
- `exec.LookPath` 只能找到系统目录里的命令；
- 所有装在 homebrew / `~/.local/bin` / `~/.opencode/bin` 的 agent 全部「探测不到」。

同一份代码里远程探测（`makeFindCommandScript`）原本就有候选目录兜底，本地没有——这种
不对称是历史遗留，**不得再出现**。

## 不变量

1. **候选目录只有一份定义。** `candidateDirSpecs`（`pkg/service/clientservice/clientservice.go`）
   是唯一来源；本地扫描（`candidateCommandDirs`）与远程脚本
   （`candidateCommandDirsForScript`）都必须从它派生。**禁止**在别处再写一份目录字面量。
2. **本地探测顺序固定**：`exec.LookPath`（快路径）→ 候选目录 stat 扫描 → 登录 shell PATH。
   候选目录必须排在登录 shell 之前，因为 stat 是确定性的，而起 shell 有成本。
3. **登录 shell PATH 是 best-effort。** 必须：
   - 只解析一次并缓存（`sync.Once`）；
   - 有超时上限（当前 3s）；
   - 任何失败（超时 / 非 POSIX / shell 报错）都退化为「没有额外目录」，**不得**让探测失败；
   - Windows 直接跳过。
   实现用 `env` 输出解析 `PATH=` 行，而不是 `echo $PATH`——fish 的 PATH 是列表类型，
   打印方式各 shell 不一致；但 PATH 导出到子进程时一定是冒号连接的字符串。
4. **新增 agent 安装目录必须进 `candidateDirSpecs`。** 例如 opencode 官方默认目录
   `~/.opencode/bin`、未来某个 agent 的 `~/.foo/bin`。判定标准：官方安装器/包管理器会在
   非系统 PATH 目录落可执行文件。
5. **可执行判定与 shell `-x` 语义一致**（Unix：`mode & 0111 != 0` 且非目录；Windows：存在即可）。
6. **不改前端过滤逻辑。** 修复点在 Go 的命令探测层；`getAgentProfileOptions` 保持
   「探测不到就隐藏」的既有语义。

## 已知目录清单

| 目录 | 来源 |
|---|---|
| `$HOME/.opencode/bin` | opencode 自安装器 |
| `$HOME/.local/bin` | pipx / uv / 通用用户 bin |
| `$HOME/bin` | 传统用户 bin |
| `$HOME/.npm-global/bin` | npm 全局（自定义 prefix） |
| `$HOME/.bun/bin` | bun 全局 |
| `$HOME/.cargo/bin` | cargo / rustup |
| `/opt/homebrew/bin` | macOS Apple Silicon homebrew |
| `/usr/local/bin` | Intel homebrew / 通用 |

## 验证方式

```bash
# 定向测试（含「裸 PATH 下仍能命中 ~/.opencode/bin」用例）
./.tools/go/bin/go test ./pkg/service/clientservice/...

# 手工模拟 GUI 环境
env -i HOME=$HOME SHELL=/bin/zsh PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  ./.tools/go/bin/go test ./pkg/service/clientservice/ -run TestFindCommandFallbackToCandidateDir
```

## 反例（不要这样做）

- 在 `FindCommand` 里直接 `exec.Command("sh", "-lc", "command -v ...")`：每次调用起 shell，
  高频面板打开会被放大；且无 TTY 下行为不稳。
- 把候选目录写进前端 TS：前后端两份清单必然漂移。
- 用 `os.Getenv("PATH")` 拼登录 shell：GUI 进程的 PATH 就是那个裸值，等于没修。
