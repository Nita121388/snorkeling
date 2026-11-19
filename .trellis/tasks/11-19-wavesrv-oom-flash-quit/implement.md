# implement.md — wavesrv OOM 闪退修复执行计划

> 前置：`prd.md`（G1 待签）+ `design.md`（G4 待评审）。
> 每步自带验证命令；**验证不绿不进下一步**。
> 三个 D 独立成 commit，任一可单独 revert。

## 环境自检

```bash
node --version          # ≥ 20
go version              # 1.25.x（GOMEMLIMIT 1.19+ 均可）
git status --short      # 了解工作区现状，不得混入无关改动
```

---

## T1 D-C scanTitle 超大行（最小、先落，独立可回滚）

**产出**
- `pkg/aisessions/provider_pi.go`：`scanTitle` 内 `scanner.Scan()` 后加
  `if int64(len(line)) > maxTitleLineBytes { continue }`（`maxTitleLineBytes = 4 << 20`），
  常量放文件顶部 `const` 块，带注释说明 OOM 根因（`[]byte(line)` stringtoslicebyte 翻倍分配）。
- `pkg/aisessions/provider_pi_scan_title_test.go`：新增
  - `TestScanTitleSkipsOversizedLine`：临时文件里 5MB base64 行 + 正常 session_info 行，
    断言返回正常 title、不 panic。
  - `TestScanTitleOversizedUserMessageFallsBack`：>4MB 的 user message 行被跳过，
    返回空 first user message（回落 DisplayTitle 语义）。
  - 耗时断言：单文件全扫描 < 1s（防回归成全量解析）。

**验证**
```bash
cd /e/code/snorkeling && go test ./pkg/aisessions/ -run 'TestScanTitle' -count=1 -v
# 期望：全部 PASS，无 panic
```

**commit**：`fix(aisessions): skip oversized pi scan lines in scanTitle`

---

## T2 D-B GOMEMLIMIT（小步，独立可回滚）

**产出**
- `emain/emain-wavesrv.ts` `spawnWaveSrv` 的 `envCopy` 初始化块末尾：
  读 `WAVE_SRV_MEM_LIMIT_MB`（覆盖默认 1024）→ `envCopy["GOMEMLIMIT"] = <bytes>`。
  启动日志打一行 `wavesrv GOMEMLIMIT: <bytes>`（进 waveapp.log 供 A4 验收）。

**验证**
```bash
# 单测（若 emain 有测试基建则补，无则靠 T3 真机验证）
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"   # 不超过基线
```

**commit**：`feat(emain): GOMEMLIMIT for wavesrv (default 1GiB, WAVE_SRV_MEM_LIMIT_MB override)`

---

## T3 D-A wavesrv respawn（核心改动，最后落）

**产出**
1. `emain/emain-wavesrv.ts` 重构 + respawn：
   - 抽 `spawnWaveSrv(): Promise<child_process.ChildProcessWithoutNullStreams>`
   - 模块级 `respawnTimestamps: number[]` 限流（60s/3 次、总 10 次）
   - `proc.on("exit")`：保护链（更新中 → 用户主动退出 → 限流超限 `dialog` + quit
     → `setTimeout(respawn, 1000)`）
   - respawn 成功（新 `WAVESRV-ESTART` 解析后）→ `getAllWaveWindows().forEach(w => w.webContents.reload())`
   - 导出 `respawnWaveSrvIfAllowed(): void` 便于测试与手动触发
2. `emain/emain-activity.ts` 确认 `setForceQuit` / `setUserConfirmedQuit` 的语义：
   用户正常 Quit 时二者至少其一为 true，respawn 分支不触发。
   **若发现语义不符**（如正常退出未置位），在 `before-quit` 补置位，不另起机制。
3. 主进程单测（`emain/emain-wavesrv.test.ts`，用现有测试基建或新增）：
   - 限流纯函数单测（60s 窗口计数、超限判定）

**验证**
```bash
# ① 单测
npx vitest run emain/ 2>/dev/null || node --test "emain/**/*.test.ts"
# ② tsc 基线不劣化
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"
# ③ 真机（A1/A2/A3 验收，需 dev 实例或已安装版）
#    A1: kill wavesrv.x64 → 窗口存活，~2s tab 恢复
#    A2: 60s 内 kill 4 次 → 第 4 次弹窗退出
#    A3: 菜单 Quit → 全部进程退出
```

**commit**：`feat(emain): wavesrv crash respawn instead of app quit`

---

## T4 收尾

1. `npm test` 全量回归（对照基线不新增失败）
2. 更新 `docs/project/verify-ledger.md` 一行结论（真机 A1/A2/A3 走 verify 台记录）
3. PRD 的 AC 打勾、spec 若有新坑回写 `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md`

---

## 回滚点

| 步骤 | 回滚方式 |
|---|---|
| T1 | `git revert <commit>` 单 revert |
| T2 | `git revert <commit>` 单 revert |
| T3 | `git revert <commit>`；紧急情况 `main` 上直接 revert（无数据迁移） |

## 风险与预案

- **respawn 后前端 reload 丢未保存输入**：composer 里的草稿会丢。风险已知（对比现状
  整窗闪退是净改善）；若需保留，后续任务做渲染侧草稿持久化。
- **respawn 风暴**（wavesrv 起来立刻又 OOM）：限流 60s/3 次兜底，超限弹窗退出。
- **多窗口场景**：reload 全部窗口，时间 ~2s；tab 状态由 wavesrv db 持久化自动恢复。