# 2026-11-19 下午追加：闪退时「PowerShell 未处理异常」根因调查（fsmonitor 泄漏）

> 状态：调查完成、结论已证实；修复未动工（等决策）。可视化报告：
> `docs/answers/crash-powershell-oom-20261119-1532.html`。
> 探查脚本已清理，命令全部记录在本文「验证命令」一节，可随时重放。

## 结论（已证实）

**用户看到的「PowerShell 未处理异常」= `powershell.exe` 的 `System.OutOfMemoryException`，是整机 commit 内存耗尽的受害者，不是凶手。** 闪退与 PS 弹窗同因：那一刻全机申请不到内存。

证据链（Windows 事件日志 + waveapp 日志，2026-11-19 11:12 一分钟内四进程齐崩）：

| 时刻 | 进程 | 事件 |
|---|---|---|
| 11:12:10 | dwm.exe | Application Error 1000，0xc00001ad |
| 11:12:10 | MSPCManagerService.exe | 0xc00000fd 栈溢出 |
| 11:12:13 | wavesrv.x64 | `VirtualAlloc failed errno=1455`（=ERROR_COMMITMENT_LIMIT）→ `fatal error: out of memory` |
| 11:12:19 | powershell.EXE | WER P3=`System.OutOfMemoryException` |

14:54:58 又一起 powershell OOM；当前这套 Snorkeling 进程全部是 14:55:39–14:58 重启的——就是那次闪退。旧版 emain 在 wavesrv exit 时 `app.quit()`，弹窗压在整窗消失的瞬间，所以用户把两者关联起来。

## commit 账本（2026-11-19 15:30 实测，开机 7.3h）

- 物理 14.8GB + pagefile **11.5GB**（`E:\pagefile.sys` AllocSize 11843MB）= 提交上限 **26.4GB**，已用 **24.9GB（94%）**，余量 ~1.5GB。
- ⚠️ PRD 里写「页面文件已人工调到 16GB 初始 / 24GB 最大、上限 38.8GB」——**实测当前上限只有 26.4GB**，需复查那次调整是否生效/被系统托管覆盖。
- 按进程聚合（合计 19.5GB）：chrome 44 个/4.18G · **git 67 个/2.85G** · node 22 个/2.83G · Snorkeling 10 个/2.12G · powershell 15 个/0.75G · WeChatAppEx+webview2+Weixin 1.84G。无单一大户，是叠加顶满。

## 新发现：git fsmonitor 常驻泄漏（2.85GB 纯损失）——为什么会有

**67 个 `git fsmonitor--daemon run --detach --ipc-threads=8`**：每个 36–80MB commit、父进程全部已退出、最老 434 分钟（= 开机即有）、一个没退。named pipe 一仓一个（`<gitdir>/fsmonitor--daemon.ipc`）。

泄漏机制（三层叠加）：

1. **Git for Windows 系统级默认 `core.fsmonitor=true`**（`D:/SoftWare/Git/etc/gitconfig`，git 2.45.1，非仓库自配）。
   任何会**刷新索引**的 git 命令（status / add / commit / diff…）第一次在某个 worktree 运行，就就地拉起一个 per-worktree 常驻 daemon；
   `git rev-parse` 不拉起（实验：rev-parse 前后 daemon 数不变）。
2. **daemon 永不退出**：`git fsmonitor--daemon -h` 只有 detach / ipc-threads / start-timeout 三个参数，没有空闲超时；实测闲置 7 小时不退。
   同仓重复 status 会复用（不涨），所以是「一仓一僵尸」，不是同仓重复。
3. **Snorkeling 的 VCS 扫描把几十个仓的 daemon 一次全拉起**：`pkg/wshrpc/wshremote/vcs.go` 的
   `detectRepoRoots(basePath, scanDepth=3, MaxVcsRepos=64)` —— 对 base 目录 `WalkDir` 找 `.git`/`.svn`，
   每个仓跑 `git status --porcelain=1 -uall`（`vcsCollectGitStatus`）。
   对 `E:\code` 这类几十仓的目录扫一遍 = 每仓一个常驻 daemon。**观察到的 ~60 个真实仓 daemon 与 MaxVcsRepos=64 几乎吻合**。

临时仓也中招：`E:/primary/projects/data-guardian-dev/scripts/tests/dgdb_check.py` 用
`tempfile.mkdtemp(prefix="dgdb-check-")` 建临时 git 仓且**从不清理**；`%TEMP%` 已躺 **225 个** `dgdb-check-*`，
其中 7 个挂着活 daemon；后台还有 `DG_CODE/DG_DATA` smoke bash 在反复跑（即泄漏源仍在持续生产）。

另一个佐证：15:20→15:32 观察窗内，无人操作 daemon 数 67→68（+1 是我建的测试仓），且测试时
`git init+add+commit` 后该仓即被 watching——**写操作也会拉起 daemon**。

## 顺带发现（同一趟查出，未处理）

- `%LOCALAPPDATA%\snorkeling-agentstatus-hook.log` 已 **230MB / 145 万行**（2026-07-10 起累计），无轮转，hook 每触发一次同步追加 ~5 行。
- WER 对 node.exe 记过 `RADAR_PRE_LEAK_64`（内存泄漏检测标记）；当前 22 个 node 共 2.83G。
- powershell 15 个常驻 0.75G：Claude 的 agentstatus hook 每次触发起一个 `powershell -NoProfile -File hook.ps1`（高频起停的 .NET 进程，OOM 时最容易被看见的那个）。

## wavesrv OOM 时间线（本任务已有结论的补充）

11-16 ×1（14:59）/ 11-17 ×1（15:29）/ 11-18 ×3（10:00、15:46、16:18）/ 11-19 ×3（09:26、11:12、13:36）。
13:36 那次 goroutine dump 直接把 waveapp.66.log 写到 11.6MB 收尾。
本任务 R1/R2/R3（respawn、GOMEMLIMIT、scanTitle）已交付（314ef270c / 5b0e964c3 / 9361cba15）；
注意 **GOMEMLIMIT 治不了本次根因**——VirtualAlloc errno=1455 是系统级 commit 耗尽，Go 自身限额无效。

## 今晚待办（按优先级）

1. **决策+清僵尸**：批量结束 67 个 `git fsmonitor--daemon`（按 command line 过滤 PID 结束，不是按进程名盲杀 git），可立刻回收 ~2.9G commit。
2. **找持续泄漏源**：观察窗内 daemon 仍在涨；用 `Win32_ProcessStartTrace` 审计谁在起新 git，确认是 Snorkeling VCS 轮询 / VS Code / dgdb smoke 哪一路。
3. **修复决策**：
   - 产品侧：`vcs.go newVcsCommand` 已是所有 git 调用唯一入口（现在统一加 `-c core.quotePath=false`），**同一行加 `-c core.fsmonitor=false` 即可全量生效**，改动极小——建议开新包（不属于本任务 R 范围）。
   - dgdb_check.py：`finally` 清理临时仓 + git 调用带 `-c core.fsmonitor=false`；顺手清 225 个残留目录。
   - hook 日志轮转/截断。
   - 系统级是否关 `core.fsmonitor`（需管理员，影响全机 git 性能 vs 40MB×N 常驻，二选一）。
4. **复查 pagefile 实际生效值**（PRD 声称 16/24GB，实测 11.5GB）。

## 验证命令（可重放）

```powershell
# daemon 清点 + 年龄 + 父进程
Get-CimInstance Win32_Process -Filter "Name='git.exe'" | Select ProcessId,ParentProcessId,CommandLine
# named pipe → 属主仓库
Get-ChildItem '\\.\pipe\' | Where-Object Name -match fsmonitor | Select -Expand Name
# commit 账本
Get-CimInstance Win32_OperatingSystem | Select TotalVisibleMemorySize,FreePhysicalMemory,TotalVirtualMemorySize,FreeVirtualMemory
Get-CimInstance Win32_PageFileUsage
# 事件日志 OOM 证据
Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddDays(-14)} |
  ? { $_.ProviderName -match 'Application Error|\.NET Runtime|Windows Error' }
# 单仓 daemon 状态
git fsmonitor--daemon status
```

受控实验（已做过，结论）：`tmp` 新仓 `git init+add+commit` 后 `git fsmonitor--daemon status` → watching；
再 `git status --porcelain` daemon 总数不变（复用）；`git rev-parse --show-toplevel` 不拉起。

## 修复方案 A（产品侧 `-c core.fsmonitor=false`）的缺点分析（2026-11-19 晚，待拍板）

> nita 指示「先记录下来，明天继续分析」。以下为已确认的缺点与正确做法，尚未拍板、未动工。

### A 的四个缺点

1. **大仓 status 变慢（主要代价）**：fsmonitor 让同一仓的后续 status 复用事件日志；关掉后每次全量扫工作区。
   小/中型仓无感；超大仓（几十万文件）单次可能亚秒→1-3s；`detectRepoRoots` 上限 64 仓，多超大仓同扫时总耗时增加。
   注意：daemon 拉起时的第一次 status 本来就是全量扫，变慢的只是"后续"；我们的扫描对每仓跑的次数不多，实际损失通常小。
2. **治不了存量、管不住别人**：已跑的 67 个不会自己退（仍需 C 清理）；其它工具（VS Code git 集成、用户终端里的 git）照样拉新 daemon。
3. **覆盖面不止一处**：内部构造 git 命令至少两处——`pkg/wshrpc/wshremote/vcs.go:154`（已有 `-c core.quotePath=false`）
   与 `pkg/sync/transport_git.go:92`（同步传输，同样能在仓里跑 git 拉起 daemon）。
   必须收口到统一命令构造器（一处加、处处生效），漏一处就有漏网。
4. **静默覆盖用户选择**：用户特意开 fsmonitor（超大仓求快）会被 app 内部静默关掉。
   影响范围小：只影响 Snorkeling 内部 VCS 面板/同步的命令；用户终端块里自己敲的 git 走 shell，完全不受影响。在意的话做成设置项（默认关）。

### 隐藏优点

部分 git 版本 fsmonitor 有事件丢失→状态过期的已知 bug；关掉后 VCS 面板状态反而更可靠。

### 明天的分析清单（nita 继续）

- [ ] 实测一次无 daemon 下大仓 status 的耗时基线（Windows 机，找一个最大的仓）
- [ ] 审计内部 git 调用点全集（除 vcs.go / transport_git.go 外还有没有第三处）
- [ ] 决定：A 是否做成设置项（默认关）还是硬编码；是否同时做 B（系统级 unset）与 C（清存量 67 个，命令已记录在上文）
- [ ] 拍板后开包：统一命令构造器收口 + 单测（断言所有内部 git 调用带 `-c core.fsmonitor=false`）+ Windows 真机验证 daemon 数不涨
