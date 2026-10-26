# Design：本地 Agent 命令探测的 PATH 回退

## 现状代码

`pkg/service/clientservice/clientservice.go`

```go
func (cs *ClientService) FindCommand(ctx context.Context, command string) (string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", nil
	}
	path, err := exec.LookPath(command)
	if err != nil {
		return "", nil
	}
	return path, nil
}
```

`makeFindCommandScript`（远程用，字符串拼接的 shell 脚本）里硬编码了候选目录：

```
~/.local/bin  ~/bin  ~/.npm-global/bin  ~/.bun/bin  ~/.cargo/bin
/opt/homebrew/bin  /usr/local/bin
```

## 方案

### 1. 抽一个共享的候选目录列表（`commonCandidateDirs(home)`）

返回 `[]string`，同时服务本地和远程：

- `$HOME/.opencode/bin`（**新增**，opencode 官方默认目录）
- `$HOME/.local/bin`
- `$HOME/bin`
- `$HOME/.npm-global/bin`
- `$HOME/.bun/bin`
- `$HOME/.cargo/bin`
- `/opt/homebrew/bin`
- `/usr/local/bin`

### 2. 本地 `FindCommand` 改为两阶段

```go
func (cs *ClientService) FindCommand(ctx context.Context, command string) (string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", nil
	}
	if path, err := exec.LookPath(command); err == nil && path != "" {
		return path, nil
	}
	// 回退：登录 shell PATH + 候选目录（本地 GUI 启动下裸 PATH 探不到）
	if path := resolveCommandWithFallback(command); path != "" {
		return path, nil
	}
	return "", nil
}
```

`resolveCommandWithFallback`：

1. 用 `LookPath` 已失败，先尝试登录 shell 解析出的 PATH（缓存，`getLoginShellPath()`）；
   对缓存里每个 `dir/command` 做 `isExecutable` 检查。
2. 再遍历 `commonCandidateDirs` 逐个检查 `dir/command` 是否存在且可执行。

> 注意：本地不发 shell 命令（避免无 TTY 下 `exec.CommandContext` 的复杂交互），直接用
> `os.Stat` + `os.FileMode & 0111` 判断可执行位。这与远程脚本的 `if [ -x ... ]` 语义一致，
> 且更简单、更快、无网络/连接依赖。

### 3. 远程脚本复用同一列表

`makeFindCommandScript` 改为调用 `commonCandidateDirs`，避免两处硬编码漂移。

### 4. 登录 shell PATH 解析（best-effort，带缓存 + 超时）

```go
var loginShellPathOnce sync.Once
var cachedLoginShellPath []string

func getLoginShellPath() []string {
	loginShellPathOnce.Do(func() {
		cachedLoginShellPath = resolveLoginShellPath()
	})
	return cachedLoginShellPath
}
```

实现：

- `shell := DetectLocalShellPath()`（已有 helper，pkg/util/shellutil）。
- 仅 POSIX（darwin/linux）。Windows 直接返回 nil。
- `exec.CommandContext(ctx, shell, "-l", "-c", "env")` + 3s 超时。
- 从 stdout 解析 `PATH=` 行，按 `:` split。
- 失败（超时 / 无输出 / 非 POSIX）返回 nil，不影响主流程。

fish 兼容：用 `env` 而非 `echo $PATH` 避开列表类型差异。

## 为什么不直接用远程脚本方案做本地

远程方案依赖已建立的 shell client 连接（SSH/WSL），本地没有现成连接，要新建一个本地
`genconn` 通道反而更重。且 `FindCommand` 是高频调用（每次面板打开对每个 agent 调一次），
本地 `os.Stat` 比再起一次 shell 更稳更快。故本地走 stat 回退，远程保持脚本（一并统一候选目录）。

## 测试计划

- `TestFindCommandFallbackToCandidateDir`：当前进程 PATH 不含 `~/.opencode/bin`，但临时把一个
  假 `opencode` 可执行文件放进 `$HOME/.opencode/bin`，`FindCommand("opencode")` 应返回该路径。
- `TestResolveCommandWithFallback`：直接测 fallback 函数，覆盖“PATH 有 / 无”两种输入。
- `TestCommonCandidateDirsIncludesOpencode`：确认列表含 `~/.opencode/bin`。
- `TestMakeFindCommandScriptUsesSharedDirs`：远程脚本字符串含 `~/.opencode/bin`。
- （不跑真实登录 shell 解析测试，避免 flaky；`getLoginShellPath` 逻辑用表驱动单测覆盖解析函数。）
