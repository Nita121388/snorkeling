# Design: Agent OS toast 降噪

## 1. Blast radius（改动前的影响面核对）

GitNexus 索引已刷新（`node .gitnexus/run.cjs analyze`，29,874 nodes / 82,641 edges）。
`emain/os-notify.ts` 未被 GitNexus 收录（`emain/` 目录不在其 TS 索引结果里），改用 grep 核对：

| 符号 | 引用方 | 风险 |
|---|---|---|
| `sendAgentOsNotification` | `emain/emain-wsh.ts:192`、`emain/os-notify.test.ts` | LOW |
| `decideSuppression` | `emain/emain-wsh.ts:16`（导入但**未实际调用**）、`emain/os-notify.ts` | LOW |
| `AgentOsNotifySettings` | `emain/emain-wsh.ts:173`、`emain/os-notify.ts`、测试 | LOW |
| `AgentStatusOsNotify*` (Go) | `pkg/wconfig/settingsconfig.go` 声明；`pkg/wconfig/metaconsts.go` 常量；`frontend/types/gotypes.d.ts` | LOW（纯新增字段） |

`emain/os-notify.ts` 是一个自包含模块，唯一生产调用方是 `emain/emain-wsh.ts` 的
`handleAgentOsNotification`。改这个模块不影响其它子系统。

`SettingsType` 加字段是纯增量，不改已有字段语义 → 对 `SettingsType` 的其它消费者无影响。

## 2. 抑制链（新的 `decideSuppression`）

判定顺序固定，**先便宜后昂贵**，且每一步有唯一 reason 便于排障：

```
1. !masterEnabled                       -> "master-disabled"
2. !isKindEnabled(kind)                 -> "kind-disabled"
3. isAnyWindowFocused() && !notifyWhenFocused -> "window-focused"
4. idleMinMs > 0 && userIdleSeconds() > 0
      && userIdleSeconds() * 1000 < idleMinMs -> "user-active"        ★新
5. cooldownMs > 0 && now - lastSeenByBlockKind(blockId, kind) < cooldownMs
                                        -> "duplicate"                ★新
6. cooldownMs > 0 && now - lastFiredByKind(kind) < cooldownMs
                                        -> "cooldown" (+merged)        ★新
7. blockedMinIntervalMs > 0 && now - lastFiredAt(blockId, kind) < blockedMinIntervalMs
                                        -> "min-interval"              (既有)
8. 否则 -> fire
```

第 3 步修复 R7：现状是 `if (ctx.isAnyWindowFocused()) return "window-focused";`，
`notifyWhenFocused` 从未被读取，死设置。改为读设置。

第 5 步必须排在第 6 步之前：多窗口的重复上报要先被 `(kind, blockId)` 去重吃掉，
否则重复事件会被计入摘要条数，摘要会虚高。

## 3. 状态归属

主进程持有全部可变状态，renderer 崩溃/重载不会丢：

```ts
// emain/emain-wsh.ts
const lastFiredByBlock = new Map<string, number>();      // 既有：(blockId, kind) -> ts，用于 blocked per-block 冷却
const lastSeenByBlockKind = new Map<string, number>();   // 新：(kind, blockId) -> ts，跨窗口去重
const lastFiredByKind = new Map<string, number>();       // 新：kind -> ts，全局冷却
const pendingByKind = new Map<string, { count: number; timer: NodeJS.Timeout | null }>();
```

`lastSeenByBlockKind` 在第 5 步通过后**立即写入**（不管第 6 步是否抑制），
否则同一次完成在另一个 renderer 的重复上报会再次穿透。

## 4. 合并摘要

冷却窗口内被挡下的事件进入 `pendingByKind[kind].count`，并挂一个 `cooldownMs` 定时器。

定时器回调：

1. `count == 0` → 直接返回（说明期间已发过新的即时通知）。
2. 取当前 settings（重新读，不复用旧快照）。
3. 若当前用户已活跃（`userIdleSeconds() * 1000 < idleMinMs`）→ 丢弃并清零。
   理由：用户正在看屏幕，Snorkeling 界面里有 in-app 角标，不需要再打断。
4. 否则发一条摘要：`"3 个 agent 已完成"` / `"2 个 agent 等待审批"`。
5. `lastFiredByKind[kind] = now`，`pendingByKind[kind].count = 0`。

摘要走同一个 `showNotification` + `focusApp` 通道，`silent: true` 与普通通知一致。

**为什么摘要延迟到窗口结束而不是立即合并**：立即合并会让"agent 刚完成"的信号晚 60 秒，
用户以为没收到通知。leading-edge（首条立即发）+ trailing-summary（尾部合并）是标准做法。

## 5. 空闲检测

- 来源：`powerMonitor.getSystemIdleTime()`（Electron，秒，含小数）。
- 语义：**系统级**空闲时长（无键鼠输入），不是 Snorkeling 窗口是否聚焦。
- 组合效果：用户在看 Snorkeling 但没动鼠标 → 第 3 步（窗口聚焦）已拦住；
  用户在 VS Code 打字 → 第 4 步拦住；用户离开电脑 → 第 4 步放行。

**安全约束**：`getSystemIdleTime()` 在部分平台返回 0（不可用）。
`idleSec > 0` 是应用空闲抑制的前置条件，否则通知会永久静默。

## 6. 新增设置

| 键 | Go 字段 | 类型 | 默认 | 语义 |
|---|---|---|---|---|
| `agentstatus:osnotifyidleminms` | `AgentStatusOsNotifyIdleMinMs` | `*int64` | 30000 | 用户系统空闲不足该毫秒数时不提示；0 = 关闭检测 |
| `agentstatus:osnotifycooldownms` | `AgentStatusOsNotifyCooldownMs` | `*int64` | 60000 | 同 kind 冷却窗口；窗口内的事件合并成摘要；0 = 关闭冷却与合并 |

既有键语义不变：

| 键 | 默认 | 语义 |
|---|---|---|
| `agentstatus:osnotify` | true | 总开关 |
| `agentstatus:osnotifydone` | true | done 类通知开关 |
| `agentstatus:osnotifyblocked` | true | blocked 类通知开关 |
| `agentstatus:osnotifywhenfocused` | false | true = Snorkeling 窗口聚焦时也提示（本次修复为真正生效） |
| `agentstatus:osnotifyblockedminms` | 0 | blocked 的 per-block 冷却；0 = 不限 |

默认值在 `emain/emain-wsh.ts` 读取处应用（与既有 `boolValue` / `intValue` 模式一致），
Go 侧不加默认值，避免 `SettingsType` 的 `*bool`/`*int64` 语义被破坏。

生成物：`pkg/wconfig/metaconsts.go` 与 `frontend/types/gotypes.d.ts` 由
`task generate`（`go run cmd/generatego/main-generatego.go`）重新生成，不手改。

## 7. 设置 UI（Wave Config 视觉面板）

新增 `frontend/app/view/waveconfig/agentnotifysettings.tsx`，在
`waveconfig-model.ts` 的 `makeConfigFiles()` 里注册一项：

```ts
{
    name: "Agent Notifications",
    path: "agentnotifications",
    description: "OS toast for agent done / blocked",
    hasJsonView: false,
    visualComponent: AgentNotifySettingsContent,
}
```

形态对齐既有的 `ThemePickerContent`（`path` 不是真实文件，`hasJsonView: false`）。

**写入路径**：`RpcApi.SetConfigCommand`（**实现偏差，见下**）。

- Go 侧 `SetBaseConfigValue` 是**合并**语义：先读 settings.json，只替换传入的键，其余键原样保留。
- 传入 `null` 会删除该键（回到默认值）。面板暂不暴露该操作。

原计划是「读-改-写 `settings.json`」，实现时改用 `SetConfigCommand`，原因是
`pkg/wconfig/settingsconfig.go:1007` 的 `SetBaseConfigValue` 已经是安全的合并写入：
它读取现有文件 → 只替换传入的键 → 写回。未知键会被 `getConfigKeyType` 拒绝，
所以不存在「静默丢键」的风险。

**默认值共享**：默认值放在 `frontend/util/sharedconst.ts`
（`AGENT_OS_NOTIFY_DEFAULTS` / `AGENT_OS_NOTIFY_SETTING_KEYS`），主进程与设置面板同源。
`emain/` 已经通过 `@/util/...` 引用前端模块（见 `emain/emain-window.ts`），
所以这条共享路径没有新增构建约定。

**取值显示**：读 `atoms.settingsAtom`（`fullConfigAtom` 派生），走纯函数
`resolveAgentOsNotifySettings(settings)`；写完由后端 config watcher 广播回来，界面自动同步。

纯函数的意义：Go 字段是 `*bool`/`*int64`，「未设置」与「false/0」必须区分开——
未设置用默认值，显式存了 false/0 就必须用 false/0。`resolveAgentOsNotifySettings` 是这条语义的
唯一实现点，并有单测（`frontend/app/view/waveconfig/agentnotifysettings.test.ts`）。

## 8. 文案

| kind | 单条标题 | 单条正文 | 摘要标题 | 摘要正文 |
|---|---|---|---|---|
| done | `Agent done — <provider>` | `Agent finished. Click to return to the app.` | `Agents done` | `<N> agents finished. Click to return to the app.` |
| blocked | `Agent blocked — <provider>` | `Agent is waiting for input. Click to switch to the app.` | `Agents blocked` | `<N> agents are waiting for input. Click to switch to the app.` |

摘要用 provider 无关的复数形式，因为合并的可能是不同 provider。

## 9. 兼容与回滚

- 旧配置文件无新键 → 走新默认（空闲 30s + 冷却 60s）。
- 用户想要旧行为：把 `agentstatus:osnotifyidleminms` 和 `agentstatus:osnotifycooldownms` 都设 0。
- 回滚本改动只需 revert 代码；已写入 settings.json 的新键会被 Go 侧忽略（未知键不报错）。

## 10. 测试策略

`emain/os-notify.test.ts` 扩展（纯函数 `decideSuppression` 注入式，无 Electron 依赖）：

- 新增 4 条 reason：`user-active` / `duplicate` / `cooldown`。
- 空闲检测不可用（返回 0）时不抑制。
- 冷却窗口内第二次同 kind → `cooldown` + `merged=true`。
- 同一 `(kind, blockId)` 在窗口内 → `duplicate`，且不计入摘要。
- `notifyWhenFocused=true` 且窗口聚焦 → 允许 fire。

`emain/emain-wsh.ts` 的状态机（pending 计数 + 定时器摘要）需要可测：
把状态与摘要调度抽成 `emain/os-notify.ts` 里的独立单元 `AgentOsNotifyGate`，
用 vitest fake timers 测。

## 11. 不做的事

- 不加 Windows 专注助手（Focus Assist）检测——Electron 没有对应 API。
- 不做通知内容富文本、不做图标。
- 不改 `frontend/app/agent-status/agent-status-notify.ts` 的分类规则。

---

## 12. 运行时验收缺口（2026-10-22）

提交时（2026-10-22）**未完成运行时验收**：仓库里同时有多个并发任务在跑，
vite dev server 被压住，Electron 渲染器起不来稳定的实例。

**已完成的替代验证**（全部是静态/单元层面）：

- `npm exec vitest run emain/` → 43 passed（本次新增 16 个用例，覆盖 4 条新抑制原因
  + 合并摘要 + 跨窗口去重 + idle 不可用时不抑制 + 两个新开关退回旧行为）；
- `npm exec vitest run frontend/app/view/waveconfig/` → 19 passed
  （新增 `resolveAgentOsNotifySettings` 的 unset-vs-false/0 用例）；
- `go test -count=1 ./pkg/wconfig/...` → 新增 3 个键名↔字段类型契约用例全绿；
- `npm exec -- eslint frontend emain` → 本次改动的 7 个文件 **0 error**（3 个
  `rh` 未使用 warning 是 pre-existing）；仓库整体的 1 个 error 来自
  `emain/updater-shared.test.node.ts`（parserOptions.project 解析问题，pre-existing）；
- `npm exec -- tsc --noEmit` → 本次改动的文件 **0 error**（仓库既有 36 个无关错误，
  分布在 preview/term/mock 等目录，均未由本次改动引入）。

**运行时需补跑的项**：见 `prd.md` 的「待补：运行时验收」7 条。
