# Agent OS toast 降噪：空闲检测 + 冷却合并 + 跨窗口去重 + 设置 UI

## Background

Snorkeling 的系统级 toast 由 agent 状态跳变驱动（commit `52d45186` 引入）。
本机 hook 日志 `%LOCALAPPDATA%\snorkeling-agentstatus-hook.log` 重放后确认：
84 个活跃日内累计触发 **9803 条** toast，日均 **117 条**，单日最高 **184 条**，
1 分钟内最高 **16 条**，相邻间隔中位数 **106 秒**。

来源分布：`pi/done` 6099（每个 agent turn 结束）、`claude/blocked` 2281（每次 `PermissionRequest` 审批）、
`claude/done` 980（`Stop` 钩子）、`codex/blocked` 261、`codex/done` 181。

用户诉求：提醒持续打扰使用电脑，需要定位原因并给出修改方案。

## Root causes（已逐条定位到代码）

| # | 根因 | 位置 | 证据 |
|---|---|---|---|
| R1 | 默认全开，且前端无任何开关 | `emain/emain-wsh.ts:176-180` | 用户 `settings.json` 里 0 个 `agentstatus:osnotify*` 键，全走默认 |
| R2 | `done` 完全无限流 | `emain/os-notify.ts:112-115` | `settingsToIntervalMs` 只处理 `blocked`，`done` 恒返回 0 |
| R3 | `blocked` 冷却默认 0 = 不限流 | `emain/emain-wsh.ts:180` | 默认值 `intValue(..., 0)` |
| R4 | 多窗口各自订阅，主进程去重失效 | `emain/emain-wsh.ts:148` | `lastFiredByBlock` 只在 `intervalMs > 0` 时被查；`done` 恒为 0 → 永不查 |
| R5 | 抑制只看 Snorkeling 自己的窗口 | `emain/os-notify.ts:137` | `defaultIsAnyWindowFocused` 只遍历 Snorkeling 窗口 → 用户在别的软件时必弹 |
| R6 | 无 burst 合并 | 无 | 1 分钟最多 16 条独立 toast |
| R7 | `agentstatus:osnotifywhenfocused` 是死设置 | `emain/os-notify.ts:90` | `if (ctx.isAnyWindowFocused()) return "window-focused";` 从不读 `notifyWhenFocused` |

R4 的实现与注释不符：`frontend/app/agent-status/agent-status-done-ack-store.ts:189` 声称主进程会按
blockId 去重，实际 `done` 的间隔是 0，去重从未生效。

## Goals

- 默认策略：**只在用户系统空闲 ≥ 30 秒时提示**。用户正在操作电脑时一律不弹。
- 同 kind 通知在 60 秒内只出现一次；被冷却掉的事件合并成一条摘要，不静默丢弃。
- 同一 `(kind, blockId)` 在冷却窗口内重复上报只提示一次（修复多窗口重复弹）。
- `agentstatus:osnotifywhenfocused` 真正生效。
- 用户能在 Wave Config 里看到并修改全部 agent 通知开关，不依赖手改 JSON。

## Non-Goals

- 不改 agent 状态采集链路（hook / `wsh agentstatus` / WPS 事件）。
- 不改 FE 的 `decideNotifyKind` 分类规则（工作态→空闲态 = done，非空闲态→阻塞态 = blocked）。
- 不做通知内容定制、不做免打扰名单。
- 不改终端 bell（`term:bellsound`）路径。
- 不清理 hook 日志文件（另立任务）。

## Requirements

### R1 空闲检测（核心）

- 新增设置 `agentstatus:osnotifyidleminms`（int64，默认 `30000`）。
- 用户系统空闲时长（`powerMonitor.getSystemIdleTime()`）小于该值时抑制通知。
- API 不可用时（返回 0）不得抑制，必须退回旧行为，避免通知永久静默。

### R2 全局冷却 + 合并摘要

- 新增设置 `agentstatus:osnotifycooldownms`（int64，默认 `60000`）。
- 同 kind 在冷却窗口内只实际发出一次通知。
- 被冷却掉的事件不静默丢弃：累计条数，冷却窗口结束时发一条摘要通知。
- 值为 0 时不做冷却也不合并（保留旧行为）。

### R3 跨窗口去重

- 同一 `(kind, blockId)` 在冷却窗口内重复上报，只提示一次，且不计入摘要条数。

### R4 修复死设置

- `agentstatus:osnotifywhenfocused=true` 时，Snorkeling 窗口聚焦也允许提示。

### R5 设置可见性

- Wave Config 新增视觉面板，能开关：总开关、done、blocked、空闲阈值、冷却时长。
- 写 settings.json 必须保留文件中其它键（读-改-写，不整体替换）。

### R6 兼容与文档

- 旧配置文件（无新键）行为 = 新默认值。
- 设置键、默认值、语义写入文档站 `docs/docs/`。

## Acceptance Criteria

- [ ] 用户不操作电脑超过 30 秒后，agent 完成会产生一条 toast。
- [ ] 用户持续敲键盘时，agent 完成不产生 toast。
- [ ] 同一分钟内 10 个 agent 依次完成，最多产生 1 条即时 toast + 1 条摘要 toast。
- [ ] 摘要 toast 的正文包含被合并的条数。
- [ ] 打开两个 Snorkeling 窗口，同一个 agent 完成只产生 1 条 toast。
- [ ] `agentstatus:osnotifywhenfocused=true` 时，Snorkeling 窗口聚焦也会弹 toast。
- [ ] `agentstatus:osnotifyidleminms=0` 关闭空闲检测，行为回到旧版。
- [ ] `agentstatus:osnotifycooldownms=0` 关闭冷却与合并，行为回到旧版。
- [ ] Wave Config 的 Agent Notifications 面板能改开关并持久化，其它 settings.json 键不丢。
- [ ] `emain/os-notify.test.ts` 覆盖新增的 4 条抑制原因 + 合并摘要 + 跨窗口去重。
- [ ] `go build ./...` 与 `tsc` 通过；`vitest` 全部通过。
- [ ] 文档页列出全部 `agentstatus:osnotify*` 键、默认值与含义。

## Notes

- 数据来源：本机 hook 日志，按 FE 分类器 `decideNotifyKind` 重放得出，不是估算。
- 关联代码注释错误：`frontend/app/agent-status/agent-status-done-ack-store.ts:184-191`。
