# Agent OS 通知（toast）抑制契约

> 适用范围：`pkg/wconfig`（设置键）、`emain/os-notify.ts`（抑制链）、`emain/emain-wsh.ts`（接线）、
> `frontend/app/view/waveconfig/agentnotifysettings.tsx`（设置面板）。
> 来源：2026-10-22 `agent-os-notify-denoise` 任务（本机 hook 日志实测 84 天累计 9803 条 toast，
> 日均 117 条，1 分钟内最高 16 条）。

## 为什么有这个契约

Snorkeling 的系统级 toast 由 agent 状态跳变驱动（`done` = 工作态转空闲态，
`blocked` = 任意态转阻塞态）。链路是：

```
Claude/Pi hook -> wsh agentstatus -> Go agentstatus -> WPS event
  -> FE decideNotifyKind -> RPC NotifyCommand(route=electron)
  -> main decideSuppression -> Windows toast
```

这条链路历史上**没有任何限流**，于是：

- `done` 完全无限流（`settingsToIntervalMs` 只处理 `blocked`）；
- `blocked` 的 per-block 冷却默认 0 = 不限流；
- 主进程的去重表只在 `intervalMs > 0` 时被查 → `done` 恒为 0 → **去重从未生效**；
- 多个 Snorkeling 窗口各自订阅同一事件并各自上报 → 同一完成弹 N 次。

结果就是"提醒一直响、打扰用电脑"。本契约把这四层收口到一个判定函数里。

## 1. 范围 / 触发条件

改动以下任意一处都必须同步本契约：

- `agentstatus:osnotify*` 系列的设置键（Go 字段 / json tag / 默认值）；
- `emain/os-notify.ts` 的判定顺序；
- `frontend/util/sharedconst.ts` 的 `AGENT_OS_NOTIFY_DEFAULTS` / `AGENT_OS_NOTIFY_SETTING_KEYS`。

## 2. 签名

### 设置键（Go `SettingsType` → 生成的 TS `SettingsType`）

| 键 | Go 字段 | 类型 | 默认 | 语义 |
|---|---|---|---|---|
| `agentstatus:osnotify` | `AgentStatusOsNotify` | `*bool` | `true` | 总开关 |
| `agentstatus:osnotifydone` | `AgentStatusOsNotifyDone` | `*bool` | `true` | done 类开关 |
| `agentstatus:osnotifyblocked` | `AgentStatusOsNotifyBlocked` | `*bool` | `true` | blocked 类开关 |
| `agentstatus:osnotifywhenfocused` | `AgentStatusOsNotifyWhenFocused` | `*bool` | `false` | true = Snorkeling 窗口聚焦时也提示 |
| `agentstatus:osnotifyblockedminms` | `AgentStatusOsNotifyBlockedMinMs` | `*int64` | `0` | blocked 的 per-block 冷却 |
| `agentstatus:osnotifyidleminms` | `AgentStatusOsNotifyIdleMinMs` | `*int64` | `30000` | 系统空闲阈值；0 = 关闭检测 |
| `agentstatus:osnotifycooldownms` | `AgentStatusOsNotifyCooldownMs` | `*int64` | `60000` | 同 kind 冷却 + 合并窗口；0 = 关闭 |

### 抑制链（`emain/os-notify.ts`）

```ts
export interface AgentOsNotifyState {
    lastFiredByBlock: number;      // (blockId, kind) 上次实际发出
    lastSeenByBlockKind: number;   // (kind, blockId) 上次"见过"，跨窗口去重
    lastFiredByKind: number;       // kind 上次实际发出，全局冷却
}

export function decideSuppression(
    desc: AgentOsNotificationDescriptor,
    ctx: AgentOsNotifyContext,
    state: AgentOsNotifyState
): SendAgentOsNotifyReason | null;

export class AgentOsNotifyGate {
    offer(desc: AgentOsNotificationDescriptor, ctx: AgentOsNotifyContext): SendAgentOsNotificationOutcome;
}
```

`AgentOsNotifyGate` 是**主进程唯一的可变状态持有者**（per-block last-fired、
per-kind last-fired、per-(kind, blockId) last-seen、pending 计数与摘要定时器）。

## 3. 契约

### 3.1 判定顺序固定，不得调整

```
1. !masterEnabled                                  -> "master-disabled"
2. !isKindEnabled(kind)                            -> "kind-disabled"
3. isAnyWindowFocused() && !notifyWhenFocused      -> "window-focused"
4. idleMinMs>0 && idleSec>0 && idleSec*1000<idleMinMs -> "user-active"
5. cooldownMs>0 && now-lastSeenByBlockKind<cooldownMs -> "duplicate"
6. cooldownMs>0 && now-lastFiredByKind<cooldownMs    -> "cooldown"  (+merged)
7. blockedMinIntervalMs>0 && now-lastFiredByBlock<... -> "min-interval"
8. 否则 fire
```

两条顺序约束有具体后果，改动前必须想清楚：

- **第 4 步的 `idleSec > 0` 是安全阀。** `powerMonitor.getSystemIdleTime()` 在部分平台
  返回 0（不可用）。若把 0 当成"用户正在操作"，通知会**永久静默**。0 必须解释为"未知"，
  此时不抑制，退回旧行为。
- **第 5 步必须排在第 6 步之前。** 多窗口的重复上报要先被 `(kind, blockId)` 去重吃掉，
  否则重复事件会被计入摘要条数，摘要说"3 个 agent 已完成"而实际只有 2 个。

### 3.2 `lastSeenByBlockKind` 的写入时机

第 5 步通过后**立即写入**（不管第 6 步是否抑制），否则同一次完成在另一个 renderer 的
重复上报会再次穿透。但 `master-disabled` / `kind-disabled` 不写：这两者表示"功能整体关闭"，
写进去会抑制用户重新打开后紧接着到达的合法事件。

### 3.3 合并摘要

第 6 步命中（cooldown）的事件不静默丢弃：`pending[kind].count++`，并挂一个在
`lastFiredByKind[kind] + cooldownMs` 到期的定时器。定时器回调时：

1. `count == 0` → 直接返回；
2. 重新读 settings（可选的 `loadSettings` 回调）；
3. 用户已活跃 → 丢弃并清零（用户在看屏幕，Snorkeling 界面里有 in-app 角标）；
4. 否则发一条摘要（正文含条数），更新 `lastFiredByKind[kind]`，清零。

`done` 与 `blocked` 各自独立计时：审批类通知有超时压力，不该被"完成"通知的冷却吞掉。

### 3.4 默认值归属：不在 Go，在 TS

Go 侧是 `*bool` / `*int64`，**必须**保持"未设置"与"false/0"可区分。因此：

- Go 侧只声明字段，**不填默认值**；
- 默认值在 `frontend/util/sharedconst.ts` 的 `AGENT_OS_NOTIFY_DEFAULTS`；
- 主进程（`emain/os-notify.ts`）与设置面板都从这一个常量读；
- `emain/` 已经通过 `@/util/...` 引用前端模块（见 `emain/emain-window.ts`），
  所以这条共享路径没有新增构建约定。

> **Warning**：在 Go 侧给这些字段填默认值会把 `false` 和"未设置"合并成一个意思，
> 用户就再也关不掉某类通知了。

### 3.5 写设置走合并语义

设置面板用 `RpcApi.SetConfigCommand`。Go 侧 `pkg/wconfig/settingsconfig.go` 的
`SetBaseConfigValue` 是**合并**写入：先读 settings.json，只替换传入的键，其余键原样保留；
未知键会被 `getConfigKeyType` 拒绝并报错。

## 4. 校验与错误矩阵

| 条件 | 行为 |
|---|---|
| `getConfigKeyType(key) == nil` | `SetBaseConfigValue` 返回 `invalid config key: <key>`，文件不变 |
| 值的类型与字段不匹配 | `convertConfigValue` 返回 `cannot convert <key>: <err>`，文件不变 |
| `getSystemIdleTime()` 返回 0 | 视为"未知"，**不**应用空闲抑制 |
| `cooldownMs == 0` | 不限流、不去重、不合并（完全回到旧行为） |
| `idleMinMs == 0` | 不做空闲检测（完全回到旧行为） |
| `userIdleSeconds()` 抛异常 | 捕获后返回 0 → 不抑制 |

## 5. Good / Base / Bad Cases

- **Good**：用户离开电脑 30 秒后 agent 完成 → 弹 1 条 `Agent done — pi`。
- **Base**：1 分钟内 10 个 agent 依次完成 → 1 条即时 toast + 1 条摘要
  （正文 `9 agents finished. Click to return to the app.`）。
- **Bad（已修）**：开两个 Snorkeling 窗口，同一个 agent 完成 → 旧行为弹 2 次；
  新行为只弹 1 次，重复上报被第 5 步吃掉且不计入摘要条数。
- **Bad（已修）**：用户持续敲键盘时 agent 完成 → 旧行为弹窗；新行为不弹
  （`user-active`），但 Snorkeling 界面里仍有 in-app 的 D 角标。

## 6. 必测项

`emain/os-notify.test.ts`（`vitest`，用 fake timers）必须覆盖：

- `user-active` 抑制；`userIdleSeconds()` 返回 0 时**不**抑制；
- `duplicate`：同 `(kind, blockId)` 在冷却窗口内第二次上报 → `reason: "duplicate"`，
  且**不**计入摘要条数；
- `cooldown` + `merged: true`；冷却窗口结束 → 收到一条摘要，正文含条数；
- `notifyWhenFocused: true` 且窗口聚焦 → 仍然 fire；
- `idleMinMs: 0` / `cooldownMs: 0` → 退回旧行为；
- 摘要触发时用户已活跃 → 摘要被丢弃。

`pkg/wconfig/settingsconfig_test.go` 必须覆盖：每个 `agentstatus:osnotify*` 键都能被
`getConfigKeyType` 解析到正确的指针类型（`*bool` / `*int64`），并且 JSON 数字能转成
`*int64`。**这是前端面板与 Go 之间的契约**——键名写错时 `SetConfigCommand` 会静默失败。

`frontend/app/view/waveconfig/agentnotifysettings.test.ts` 必须覆盖
`resolveAgentOsNotifySettings`：未设置 → 用默认值；显式存了 `false` / `0` → **不得**被默认值覆盖。

## 7. Wrong vs Correct

### Wrong：把"未设置"和"false"混为一谈

```ts
// 错：显式 false 会被默认值覆盖，用户关不掉通知
const doneEnabled = settings["agentstatus:osnotifydone"] || AGENT_OS_NOTIFY_DEFAULTS.doneEnabled;
```

### Correct

```ts
// 对：只有 null / undefined 才回落到默认值
const doneEnabled = settings["agentstatus:osnotifydone"] ?? AGENT_OS_NOTIFY_DEFAULTS.doneEnabled;
```

### Wrong：把 idle = 0 当成"用户正在操作"

```ts
// 错：平台不报空闲时间时通知会永久静默
if (ctx.userIdleSeconds() * 1000 < ctx.settings.idleMinMs) return "user-active";
```

### Correct

```ts
// 对：0 = 未知 → 不抑制
const idleSec = ctx.userIdleSeconds();
if (ctx.settings.idleMinMs > 0 && idleSec > 0 && idleSec * 1000 < ctx.settings.idleMinMs) {
    return "user-active";
}
```

## 相关

- 文档站页：[Agent Notifications](../../../../docs/docs/agent-notifications.mdx)
- 任务：`.trellis/tasks/10-22-agent-os-notify-denoise/`
