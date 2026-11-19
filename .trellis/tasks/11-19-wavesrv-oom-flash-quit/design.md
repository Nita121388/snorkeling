# design.md — wavesrv OOM 闪退修复

> 前置：`prd.md`（待签）。本文讲**怎么实现**，需求与验收判据在 `prd.md`。

---

## 1. 三道防线与职责

| 防线 | 层 | 目的 | 兜底场景 |
|---|---|---|---|
| **D-A wavesrv 死后自动 respawn** | Electron 主进程 `emain/emain-wavesrv.ts` | 消闪退：后端挂了前端只闪一下，60s 内自愈 | OOM 仍在发生时的用户体验 |
| **D-B GOMEMLIMIT** | Go 运行时环境变量（spawn 时 `envCopy["GOMEMLIMIT"]`） | 降低 OOM 频率：wavesrv 自身 heap 在紧张时提前 GC，不再无限扩张 | 系统 commit 余量小时 wavesrv 不雪上加霜 |
| **D-C scanTitle 超大行** | `pkg/aisessions/provider_pi.go` | 去掉一次已知的高峰分配路径 | pi 会话读超大 base64 行时 |

三道防线相互独立、可单独回滚，互不依赖。

---

## 2. D-A：wavesrv respawn

### 2.1 状态机

```
           ┌───────┐        crash / kill
           │ Alive │◄──────────────────────┐
           └───┬───┘                       │
               │ exit event                │ 60s 内 respawn 计数 < 3
               ▼                           │
        ┌─────────────┐                    │
        │ 判断退出原因 │──用户主动/更新──► app.quit()（保持现状）
        └──────┬──────┘                    │
               │ 异常死亡                  │
               ▼                           │
        ┌──────────────┐                   │
        │ 限流检查     │──超限────────► dialog + app.quit()
        └──────┬───────┘                   │
               │ 通过                      │
               ▼                           │
        ┌──────────────┐                   │
        │ respawn + 等 │───────────────────┘
        │ WAVESRV-ESTART│
        └──────────────┘
```

### 2.2 关键改造（`emain/emain-wavesrv.ts`）

- `runWaveSrv` 抽出 `spawnWaveSrv(handleWSEvent): Promise<boolean>` 内部函数；
  外层保留 `runWaveSrv` 作为首次启动入口，语义不变。
- 新增模块级 `respawnCount` / `firstRespawnAt`（或滑窗数组）追踪重启节奏。
- `proc.on("exit")` 中：
  1. 已有保护：更新中 / 更新退出 → return（**保持**）
  2. 新增保护：`setUserConfirmedQuit()` / `setForceQuit(true)` 已置位 → return
     （用户主动退出，见 `emain/emain-activity.ts`）
  3. 限流：60s 窗口内 > 3 次或总次数 > 10 → `dialog.showMessageBox` 提示 + `app.quit()`
  4. 否则：`await sleep(1000)`（避免立刻再撞同一场内存风暴）→ 调 `spawnWaveSrv`
- `spawnWaveSrv` 完成后：新端点已在 `process.env[WSServerEndpointVarName] / [WebServerEndpointVarName]`
  （沿用现有 `WAVESRV-ESTART` 解析逻辑），通过 `getAllWaveWindows().forEach(w => w.webContents.reload())`
  让渲染进程重建连接（`lazy()` 缓存随 reload 清空，`getEnv` IPC 拿到新端点）。
- `waveSrvReadyResolve` 只能 resolve 一次的 promise 不能复用——respawn 走独立 promise，
  respawn 完成后不需要再 resolve 旧 ready（主进程已过了首次 ready 阶段）。

### 2.3 前端如何"无缝"重连（现实约束）

- wavesrv 端口是 `127.0.0.1:0` 随机（`pkg/web/web.go:495`），**不能固定**（否则跨进程
  抢占风险 + 现有 authkey 机制耦合端点）。因此 respawn 后端点必变。
- 处理：主进程直接 `webContents.reload()` 所有窗口。Tab/Workspace 状态全部在
  wavesrv 的 db 里持久化，reload 走现有 `10-26-tab-startup-restore` 机制自动恢复。
- 代价：用户看到 1-2 秒白屏 + tab 恢复动画。对比现状（整窗消失）是可接受的降级。
- 不做：热重连（WS 重连 + HTTP 端点切换而不 reload）。需要改 `wshrpcutil-base.ts`
  的 `initGlobalWS`、`global.ts` 的 fetch 缓存、以及 `lazy()` 缓存失效机制，风险面太大，
  留给后续 P2 任务。

### 2.4 respawn 期间用户可见反馈（可选，P2 增强）

主进程 `respawn` 前给所有 window 发一个渲染侧 toast："wavesrv 异常退出，正在自动恢复..."
通过 `webContents.send("wavesrv:respawning")` → 渲染进程监听 → 全屏半透明遮罩。
**首版不做**，先把 respawn 机制跑通。

---

## 3. D-B：GOMEMLIMIT

### 3.1 选型

Go runtime 原生识别 `GOMEMLIMIT` 环境变量（Go 1.19+，当前 go.mod 1.25.6），**不用改 Go 代码**。
在 Electron 主进程 spawn wavesrv 时把值放进 `envCopy`。

### 3.2 数值与配置

- 默认：**1GiB**（`1 << 30`）。依据：真机 wavesrv 常态 123MB WS / 123MB commit，
  1GiB 是 ~8× 余量，日常 GC 触发几乎不感知，但在系统 commit 紧张时避免 wavesrv
  单独扩张到 GB 级。
- 可调：环境变量 `WAVE_SRV_MEM_LIMIT_MB`（数字，单位 MB）；设置后覆盖默认。
- 不走 `app:settings`（那是 wavesrv 侧 config 系统，wavesrv 死了设置读不到）；
  主进程 `process.env` 是启动时注入，足够。

### 3.3 实现位置

`emain/emain-wavesrv.ts` 的 `spawnWaveSrv` 里 `envCopy` 初始化块末尾：

```ts
const memLimitMB = parseInt(process.env["WAVE_SRV_MEM_LIMIT_MB"] ?? "", 10);
const limitBytes = (Number.isFinite(memLimitMB) && memLimitMB > 0 ? memLimitMB : 1024) * 1024 * 1024;
envCopy["GOMEMLIMIT"] = String(limitBytes);
console.log("wavesrv GOMEMLIMIT:", limitBytes);
```

Go 侧零改动。

---

## 4. D-C：scanTitle 超大行

### 4.1 现状 OOM 路径

```go
// pkg/aisessions/provider_pi.go:223-228
scanner := bufio.NewScanner(file)
scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)   // max token 16MB
for scanner.Scan() {
    line := strings.TrimSpace(scanner.Text())              // string 副本 #1
    readBytes += int64(len(line)) + 1
    var value map[string]any
    if err := json.Unmarshal([]byte(line), &value); err != nil {   // []byte 副本 #2 (stringtoslicebyte)
        continue
    }
    ...
}
```

对 1.8MB 的 base64 单行：`string` 副本（#1，bufio Scanner 内部）+ `[]byte` 副本（#2，
`stringtoslicebyte` 强制分配）+ 解析后 map 对象 ≈ **行大小 ×3 瞬时分配**。
OOM 现场日志（waveapp.64.log:95058）显示 VirtualAlloc of 1.8MB 失败就是这条路。

### 4.2 修复策略

**最小改动版**（本次落地）：**超长行直接跳过 JSON 解析**。
- 阈值：`maxScanLineBytes = 4 << 20`（4MB）
- 在 `scanner.Scan()` 后、`json.Unmarshal` 前：
  ```go
  if int64(len(line)) > maxScanLineBytes {
      // base64 图片/tool-result 大块不可能是 title 或 first user message；
      // 仍累加 readBytes 保持 titleScanMaxBytes() 短路逻辑生效。
      continue
  }
  ```
- 副作用分析：pi 的 `session_info.name`、`message`（user text）行都远小于 4MB。
  如果某个 user message 真的 > 4MB（用户粘了几 MB 文本），它本来也不适合做 title，
  跳过是正确行为（`DisplayTitle` 会回落到 `ProjectPath` basename 或 session id）。

**不做**（避免过度工程）：
- 改 `bufio.Scanner` 为手动 `bufio.Reader`：侵入更大，且 4MB 阈值已挡住已知 OOM。
- 改 `titleScanMaxBytes()` 的累计上限：与本次 OOM 无直接关系（现场是单行分配失败，不是累计读）。

### 4.3 测试

新增 `provider_pi_scan_title_test.go`：
- 构造 5MB base64 单行 + 正常 header 的临时 pi 会话文件
- 调 `PiProvider.scanTitle`
- 断言：不 panic / 返回 `("", "")`（或正确 header title）/ 耗时 < 1s / 分配 < 8MB
  （用 `testing.AllocsPerRun` 辅助）

---

## 5. 改动清单与边界

| 文件 | 改动 | 风险 |
|---|---|---|
| `emain/emain-wavesrv.ts` | 抽 `spawnWaveSrv` + respawn 状态机 + GOMEMLIMIT env | 中（动主进程启动流） |
| `pkg/aisessions/provider_pi.go` | `scanTitle` 加 4MB 单行阈值 + 跳过解析 | 低（纯函数级改动） |
| `pkg/aisessions/provider_pi_scan_title_test.go` | 新增单测 | 无 |

**不碰**：前端 store、wshrpcutil、hero/persona store、任何用户数据文件、系统页面文件设置。

---

## 6. 回滚

每个改动都在一个 commit 内：
- D-A 单独 commit：`feat(emain): wavesrv crash respawn instead of quit`
- D-B 单独 commit：`feat(emain): GOMEMLIMIT for wavesrv`
- D-C 单独 commit：`fix(aisessions): skip oversized pi scan lines`

任一出问题 revert 单个 commit 即可。D-A 是"消闪退"主力，若 D-A 有问题紧急回滚不影响 D-B/D-C。

---

## 7. 验证路径

1. **D-A 手动真机**：`Get-Process wavesrv.x64 | Stop-Process -Force`（非管理员即可）→
   窗口应存活，~2s 后 tab 恢复，可正常交互。重复 4 次 → 第 4 次弹窗并退出。
2. **D-B**：启动时设置 `WAVE_SRV_MEM_LIMIT_MB=128`，启动后用 `Get-Process wavesrv.x64`
   观察 WS/Commit ≤ 128MB（GC 会压住）。真机观察 `Get-Process` 数值曲线。
3. **D-C**：`go test ./pkg/aisessions/ -run TestScanTitle -count=1` 通过。
4. **回归**：`npm test` 既有用例不新增失败；tsc 基线不劣化。

---

## 8. 待确认（G4/G6 门）

1. respawn 限流阈值：60s/3次 / 总 10 次 — 是否合理？是否需要用户可配置？
2. respawn 时白屏可接受？还是要先加渲染侧 toast（P2 增强）？
3. GOMEMLIMIT 默认 1GiB — 与用户实际内存（16GB）的比例可接受吗？
4. D-C 4MB 阈值 — 是否需要走 `titleScanMaxBytes()` 同样的可配置机制？