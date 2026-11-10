# 同步诊断复制：失败态 / 服务端不可达 / 协议不兼容

> 父任务：11-10-copy-for-agent
> 依赖：cfa-core
> 关联：11-09-commontext-sync-config-fixes（server 自部署线）、settings-density 原型（Server status 卡形态已定稿）

## Background

「同步失败」是界面上唯一无法自证的状态：`syncmanager.Status` 只有 `problem` / `lastError` 两个字符串，
真正的证据在 `pkg/syncjournal` 事件流（run start / pull / push / conflict / error / run end）里，
用户目前无法从 UI 拿到，只能口述「同步失败了」。

服务端侧：`pkg/syncclient/client.go:54` `Probe{ URL, Ready, Health, Checks }` 与
`pkg/syncproto/syncproto.go:46` `Health{ ProtocolVersion, AppVersion, Items, Rev, RequiresAuth, Capabilities }`
全都在，但**没有任何 RPC 暴露**（全仓只有 `wsh commontext-sync doctor --json` 走这条路）。
`wshcmd-commontext-sync.go:547` 注释明说 doctor 的设计就是「agent 读 `checks[].fix` → 执行 → 再跑 doctor」。

settings-density 原型已把 Server status 卡与信号格形态定稿（commit 113be526），
其中「不可达」态已画了 `wsh commontext-sync doctor --json` + Copy 按钮——本任务把 Copy 的内容
从「一条命令」升级为「整块诊断文本」。

## Goal

三个失败态各给一个 `Copy for agent`，复制的是证据本体（journal 事件 / probe checks / 双端版本），
不是「请你跑一条命令」。

## Requirements

### R1 RPC

- `CommonTextService.SyncProbe` → `*syncclient.Probe`（server transport 时）+ 客户端 protocolVersion；
  非 server transport 返回 `{ transport }`（不做无意义探测）。
- `CommonTextService.SyncJournalTail` → `{ n: number; events: syncjournal.Event[] }`，默认 n=20，
  上限 100（防止无限大 payload）。
- 两者均需注册 RPC 类型与前端 d.ts（走生成，不手改）。

### R2 Sync 失败态复制

- Status 组「Last sync」行：`lastError != ""` 时该行右侧出现 `<CopyForAgent>`，payload =
  Context（transport / deviceName / lastRunAt / intervalSeconds / lastError / 最近 N 条 journal 事件，
  事件行格式与 `wsh commontext-sync log` 输出一致）+ Task（"Diagnose why the last sync run failed and
  name the smallest fix"）+ Output contract（`DIAGNOSIS_BRIEF`：一句话结论 + 修复命令，不写分析长文）。
- `conflicts > 0` 时的复制入口归 cfa-commontext-conflict 任务，本任务不重叠。

### R3 服务端不可达复制

- Server status 卡（形态沿用 settings-density 定稿：信号格 + 三态）不可达态：
  `<CopyForAgent>` payload = Context（URL / probe 全部 checks（含 fail 与 fix 字段）/ health 或
  `unreachable` / 客户端版本）+ Task（"Diagnose the unreachable sync server and name the smallest fix"）
  + Output contract（`FIX_COMMAND_ONLY`）。
- 原型里「Copy 按钮复制 doctor 命令」升级为复制完整诊断块；命令本身作为 Context 的一行保留
  （agent 可以选择直接执行）。

### R4 协议不兼容复制

- probe 返回 `Compatible() == false`（`pkg/syncproto` 既有判定）时，Server status 卡显示
  协议不兼容行，`<CopyForAgent>` payload = Context（客户端 protocolVersion / 服务端 protocolVersion
  与 appVersion / capabilities）+ Task（"Decide which side must be upgraded for protocol compatibility"）
  + Output contract（`DIAGNOSIS_BRIEF`）。

## Acceptance（命令 → 期望输出）

- [x] `go test ./pkg/syncmanager/... ./pkg/service/commontextservice/...` → 全绿；新增 `SyncJournalTail` 超上限截断（`syncmanager_diag_test.go` clamp 到 100）与 `SyncProbe` 非 server 短路（`commontextservice_test.go`）两用例；`FormatEventLine` 与 CLI `log` 行格式逐字一致由 golden 测试锁死。
- [x] 手动把 folder 路径改错触发失败运行：真机 verify 场景 3（folder 指向 /etc/hosts 下必失败路径 + 播种 1 条 item），复制文本含 `last error:`、`recent events (`、`### Task`、`### Output contract`，事件条数 ≤ 20。
- [x] 指向不存在的 server URL：真机 verify 场景 2，复制文本含 `checks:` 行与 `fix:` 行，且含 `client protocol version:`。
- [x] 真机验证台：新 area `scripts/verify/sync-diagnostics-copy/verify.mjs` → **20/20 全绿**（launch+reset），台账已记；area 已登记 README。

## 实施偏离与附带修复（2026-11-10）

- **Server status 卡未落地**（属 11-09-commontext-sync-config-fixes 后续）：本任务在 Status 组加了一个「Sync server」行（仅 server 传输时出现：Check 探测 + 不可达/协议不兼容时的 Copy for agent），作为卡落地前的最小承载面；卡形态本身仍留给后续任务。
- 真机 verify 挖出两个真 bug 并修复：
  1. `syncsettings.tsx runSyncNow`：失败路径不刷新状态 → lastError 永远到不了面板，补 `refreshSyncStatus()`。
  2. `pkg/syncmanager`：`reload()` 成功时无条件清空 `lastError`，run 失败错误被抹（`GetStatus` 每次 reload）→ 拆分 `lastRunError`（run 错）与 `lastError`（build/配置错），状态取 `firstNonEmpty(lastRunError, lastError)`。

## Touch（白名单）

- `pkg/service/commontextservice/commontextservice.go`
- `pkg/syncmanager/syncmanager.go`（暴露 journal 尾巴的读取函数）
- `pkg/sync/transport_server.go`（Probe 透传，如已具备则不动）
- `pkg/wshrpc/wshrpctypes.go`、`frontend/types/gotypes.d.ts`（生成）
- `frontend/app/view/waveconfig/syncsettings.tsx`
- 原型 `design/prototypes/settings-density/`（Server status 卡文案微调，不重排结构）

## Out of Scope

- 健康度信号格与 Server status 卡本身（已在原型定稿，落地 Server status 属
  11-09-commontext-sync-config-fixes 后续；本任务只管复制按钮与数据）。
- 自动重试 / 修复执行。
