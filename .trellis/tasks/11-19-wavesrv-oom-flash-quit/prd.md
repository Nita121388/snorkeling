# wavesrv OOM 闪退修复：自动重启 + GOMEMLIMIT + scanTitle 超大行

> 本任务是 P0 修复包（一天 2-3 次整窗闪退，有完整真机日志证据链）。

## Goal

Snorkeling 每天闪退 2-3 次。根因链条（真机证据完整）：

```
系统 commit 内存耗尽（16GB 物理 + 页面文件 12GB ≈ 上限 22.8GB，常态余量仅 4GB）
  → wavesrv（Go 后端，自身仅 ~123MB）申请 8KB~1.8MB 内存失败
  → Go runtime `fatal error: out of memory`（errno=1455）
  → emain/emain-wavesrv.ts `proc.on("exit")` → `electron.app.quit()`  ← 整窗消失=闪退
```

日志证据：`~/AppData/Local/snorkeling/Data/logs/waveapp.6*.log` 中
11-13 ×5 / 11-14 ×1 / 11-16 ×1 / 11-17 ×1 次 `fatal error: out of memory`，
触发点分布：GC worker、`SQLiteIndex.MigrateMetaJSON`（启动读 meta.json）、
`PiProvider.scanTitle`（pi 会话内嵌 base64 图片的超大行，`[]byte(line)` 翻倍分配 1.8MB）。

**已先落地（人工，非本任务代码）**：页面文件 8GB→16GB 初始 / 24GB 最大，commit 上限
22.8GB→38.8GB，余量 4GB→15GB+。本任务做代码侧三道防线，让"即使再 OOM 也不闪退 / 更少 OOM"。

## Requirements

### R1 wavesrv 死后自动重启（核心：消闪退）
- wavesrv 进程异常退出（非更新安装、非用户主动退出）时，**不再 `app.quit()`**，
  改为自动 respawn 新 wavesrv 并让前端全部重连。
- 重启次数限流：短时间（如 60s）内最多 3 次；超限则回退"弹窗告知 + 退出"
  （防崩溃循环死锁）。
- 用户主动退出（Quit / Ctrl+Q / 更新）仍走原退出路径，不受影响。

### R2 wavesrv 内存自限（降低 OOM 频率）
- wavesrv 启动时设 `debug.SetMemoryLimit`（GOMEMLIMIT），让 Go GC 提前激进回收、
  把自身 heap 压在阈值内，避免在系统 commit 紧张时继续扩张。
- 初始阈值取一个保守值（如 512MB），通过环境变量 `WAVE_SRV_MEM_LIMIT_MB` 可调。

### R3 scanTitle 超大行优化（去掉典型一次性分配峰值）
- `pkg/aisessions/provider_pi.go` 的 `scanTitle`：当前对超大行
  `json.Unmarshal([]byte(line), &value)` 会先造一个同尺寸 string 副本再转 []byte，
  峰值为行大小 ×3（1.8MB 的 base64 行 → ~5.4MB 瞬时）。
- 改为：超长行（如 > 4MB）跳过解析（标题几乎不可能藏在 base64 行里），
  或改 bytes.Reader 避免 string→[]byte 复制。

### R4 限制范围（不做）
- 不改 Electron 渲染进程的内存策略（那是另一片海，非本次闪退根因）。
- 不改系统页面文件设置（已人工完成）。
- 不做跨版本迁移 / 不碰用户数据文件（只读日志与配置）。

## Acceptance Criteria（每条都要能机器判定）

- [ ] **A1 自动重启**: 杀掉运行中的 wavesrv 进程（`Get-Process wavesrv.x64 | Stop-Process`），
      观察 Electron 窗口**不消失**，60s 内自动恢复可用（前端重连成功、Tab 内容可交互）。
      → **待真机**（代码已落 `314ef270c`，需起 dev 实例验）
- [ ] **A2 限流**: 连续 kill wavesrv 4 次（间隔 < 60s），第 4 次应用退出并提示，不无限循环。
      → ✅ 单测达成（`emain-wavesrv.test.ts` 4 例，含第 4 次拒 + dialog）；**真机待验**
- [ ] **A3 主动退出不受影响**: 正常 Quit（菜单）进程全部退出，无多余 respawn。
      → **待真机**（退出保护链代码已落；before-quit 所有分支均置位三标志之一）
- [ ] **A4 GOMEMLIMIT**: 设置 `WAVE_SRV_MEM_LIMIT_MB=128` 启动，waveapp.log 出现
      GOMEMLIMIT 生效证据（日志行或 heap 峰值 ≤ 阈值）。
      → **待真机**（`5b0e964c3` 启动打日志行 `wavesrv GOMEMLIMIT: <bytes>`）
- [x] **A5 scanTitle**: `scanTitle` 对 >4MB 单行不再分配 ≥ 行大小的 []byte；
      单测覆盖：构造 5MB base64 行，断言不 OOM、返回空标题、耗时 < 1s。
      → ✅ **达成**（`9361cba15`，3 用例全绿：超大 assistant 行跳过 / 超大 user 行回落 / 4MiB-1KB 仍解析，均 < 1s）
- [x] **A6 回归**: `npm test`（既有范围）不新增失败；tsc 基线不劣化。
      → ✅ **达成**（go test ./pkg/aisessions/ 全包 ok 39.6s；vitest emain/ 62 passed；tsc 总 55 错 = 预存基线，本任务三个文件零新错）

## Notes / 约束

- **数据安全红线**：本任务只读配置/日志，不写用户数据文件；改动仅限
  `emain/`、`cmd/server/`、`pkg/aisessions/`、`pkg/wavesrv/`（新建 GOMEMLIMIT 启动点）。
- Windows 是主战场（用户真机 win32/x64），macOS/Linux 行为保持兼容（respawn 逻辑平台无关）。
- wavesrv 端口每次随机：重启后 `process.env.WAVE_SERVER_*_ENDPOINT` 更新，
  前端 `endpoints.ts` 的 `lazy()` 缓存需通过窗口 reload 失效。