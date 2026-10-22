# Implement: Agent OS toast 降噪

## 0. 前置

- [x] `npm run setup`（安装 `.tools/` 下的固定工具链）
- [ ] Windows 上 Go / Task 命令走子 PowerShell：
      `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; <cmd>"`

## 1. Go 设置字段

- [x] `pkg/wconfig/settingsconfig.go`：`SettingsType` 增加两个字段
      - `AgentStatusOsNotifyIdleMinMs *int64 \`json:"agentstatus:osnotifyidleminms,omitempty"\``
      - `AgentStatusOsNotifyCooldownMs *int64 \`json:"agentstatus:osnotifycooldownms,omitempty"\``
      - 放在 `AgentStatusOsNotifyBlockedMinMs` 之后，保持字段顺序与 JSON key 顺序一致
- [x] 不在 Go 侧加默认值（默认值在 emain 读取处应用）
- [x] 重新生成：`node scripts/run-task.mjs generate`
      - 产出 `pkg/wconfig/metaconsts.go`（Generated Code，不手改）
      - 产出 `frontend/types/gotypes.d.ts`
- [x] 校验：`git diff --stat` 只应出现 metaconsts.go 与 gotypes.d.ts 两个生成物

## 2. `emain/os-notify.ts` 抑制链

- [x] `AgentOsNotifySettings` 增加 `idleMinMs: number`、`cooldownMs: number`
- [x] `AgentOsNotifyContext` 增加：
      - `userIdleSeconds: () => number`
      - `lastFiredByKind: (kind: AgentOsNotifyKind) => number`
      - `lastSeenByBlockKind: (blockId: string, kind: AgentOsNotifyKind) => number`
- [x] `SendAgentOsNotifyReason` 增加 `"user-active" | "duplicate" | "cooldown"`
- [x] `decideSuppression` 按 design.md §2 的 8 步顺序重写
      - 第 3 步读 `notifyWhenFocused`（修复死设置）
      - 第 4 步前置条件 `userIdleSeconds() > 0`（API 不可用时不抑制）
      - 第 5 步（duplicate）排在第 6 步（cooldown）之前
- [x] `buildTitleAndBody` 增加摘要文案分支（`done` / `blocked` 复数形式）
- [x] 新增 `AgentOsNotifyGate`：持有 pending 计数与摘要定时器
      - `gate.offer(desc, ctx)` → 返回 `{ fired: true }` 或 `{ fired: false, reason, merged }`
      - 冷却命中时 `pending[kind].count++` 并挂 `cooldownMs` 定时器
      - 定时器回调：count>0 时重读 settings → 用户活跃则丢弃 → 否则发摘要 → 更新 `lastFiredByKind`
- [x] 导出 `defaultUserIdleSeconds()`：包 `powerMonitor.getSystemIdleTime()`，异常时返回 0

## 3. `emain/emain-wsh.ts` 接线

- [x] `handleAgentOsNotification` 读取两个新设置（默认 30000 / 60000）
- [x] 维护 `lastSeenByBlockKind` / `lastFiredByKind` 两张表
- [x] 第 5 步通过后立即写 `lastSeenByBlockKind`
- [x] 用 `AgentOsNotifyGate` 替换直接调用 `sendAgentOsNotification` 的逻辑
- [x] `decideSuppression` 的导入若已无引用则移除（当前是未使用的导入）

## 4. FE 注释修正

- [x] `frontend/app/agent-status/agent-status-done-ack-store.ts:184-191`
      把"主进程按 blockId 去重"改成与新实现一致的描述（现在真的去重了，但窗口是 cooldownMs）

## 5. 设置 UI

- [x] 新建 `frontend/app/view/waveconfig/agentnotifysettings.tsx`
      - 开关：总开关 / done / blocked
      - 数字输入：空闲阈值（秒）、冷却时长（秒）
      - 读 `atoms.fullConfigAtom` 的 settings 显示当前值
- [x] 写入走合并语义：`RpcApi.SetConfigCommand`（Go 侧 `SetBaseConfigValue` 只替换传入的键，
      其它键原样保留）
      - 保留 settings.json 里其它全部键
      - 路径取 `model.configDir` + `settings.json`
- [x] `frontend/app/view/waveconfig/waveconfig-model.ts` 的 `makeConfigFiles()` 注册
      `{ name: "Agent Notifications", path: "agentnotifications", hasJsonView: false, visualComponent: AgentNotifySettingsContent }`

## 6. 文档

- [x] `docs/docs/` 新增/补充 agent 通知设置说明：列出全部 `agentstatus:osnotify*` 键、默认值、含义
- [x] 在 `docs/docs/agent-workflow.mdx` 或 `config.mdx` 里加交叉引用

## 7. 测试

- [x] `emain/os-notify.test.ts` 扩展
      - `user-active` 抑制
      - 空闲检测返回 0 时不抑制
      - `duplicate`（同 kind+blockId 在冷却窗口内）
      - `cooldown` + `merged=true`
      - `notifyWhenFocused=true` 时窗口聚焦仍 fire
      - `idleMinMs=0` / `cooldownMs=0` 退回旧行为
      - 摘要：fake timers 推进冷却窗口 → 收到一条摘要通知，正文含条数
- [x] `frontend/app/view/waveconfig/agentnotifysettings.test.ts`：`resolveAgentOsNotifySettings`
      的 unset-vs-false 单测（写路径改成合并语义后不再需要读-改-写单测）
- [x] `pkg/wconfig/settingsconfig_test.go`：键名 ↔ Go 字段类型契约测试

## 8. 校验命令

按顺序执行，全部通过才进 Phase 3：

```powershell
# Go
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go build ./..."
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/wconfig/..."

# 前端 / 主进程
npm exec vitest run emain/
npm exec vitest run frontend/app/view/waveconfig/
npm exec -- eslint frontend emain
npm exec -- tsc --noEmit -p tsconfig.json
```

## 9. Review gates

- [x] `node .gitnexus/run.cjs detect-changes --scope compare --base-ref main`（改动只落在预期符号）
- [x] 自查：`decideSuppression` 的 8 步顺序与 design.md §2 一致
- [x] 自查：用户 `settings.json` 里已写入的新键不丢其它键

## 10. 回滚点

- 每个 step 是一个独立 commit，`git revert` 单个 commit 即可回滚对应层。
- 设置层可独立回滚：把 `agentstatus:osnotifyidleminms` 与
  `agentstatus:osnotifycooldownms` 设 0 即回到旧行为，无需改代码。
