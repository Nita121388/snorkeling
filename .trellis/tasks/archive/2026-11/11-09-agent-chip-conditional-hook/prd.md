# Agent 状态 chip 条件调用 hook → 整窗白屏（React #310）

## Goal

修掉 `0.0.123` / `0.0.124` 上"整窗突然白屏、切 tab 无效、只能重启"的故障：agent 状态 chip 把
`useAtomValueSafe(agentStatusSecondTickAtom)` 写在 `tickEnabled ? ... : 0` 的条件表达式里，
chip 挂载期间 status 从 idle 翻到 working 时 hook 数量变化 → React 命中
`updateWorkInProgressHook` 的 "more hooks than previous render" 分支（生产构建 = Minified React error #310）
→ App 根没有 ErrorBoundary → 整棵树被卸载 → 窗口只剩 light 主题底色（米白）。

**范围边界**：三处同反模式全部改掉（chip / `useAgentChipNow` / `SessionRunBadge`），
补一条可机器判定的回归用例，并给 App 根加 ErrorBoundary 兜底（以后任何 render 异常不再整窗白屏）。

## 现场证据（2026-11-09 CDP 抓取，0.0.124）

```
01:45:32.906  tab 切到 Overview，页面开始渲染（blocks=0, text=253）
01:45:34.256  blocks=3, text=960
01:45:39.787  EXC  Uncaught Error: Minified React error #310
                at updateWorkInProgressHook   (index-rkLQ8bG-.js:241835)
                at Object.updateReducer [as useReducer]  (index-rkLQ8bG-.js:241894)
01:45:40.225  #main 子节点 0，文本 0  → 白屏
```

`--enable-logging` 同时把它写进了 `C:\temp\snork-chromium-124.log:271`：
`[27572:1109/094539.786:INFO:CONSOLE:241835] "Uncaught Error: Minified React error #310; ..."`

## 根因

`useAtomValueSafe` → jotai `useAtomValue` → 内部 `React.useReducer`（jotai 2.9.3 `react.js:48`），
与抓到的栈一一对应。三处条件 hook：

| 文件 | 行 | 消费者 |
|---|---|---|
| `frontend/app/session-overview/agent-status-chip.tsx` | 64-65 | Overview 看板卡片 / 列表 chip（**本次现场命中面**） |
| `frontend/app/agent-status/use-agent-status-view.ts` | 73-74 | Tab 悬浮卡 pill |
| `frontend/app/view/aisessions/session-run-badge.tsx` | 88-91 | aisessions 运行指示 |

引入提交：`1ee8db4b`（chip 收口）、`3943dbb7`（Tab 悬浮卡补跑时）、`52556187`（运行指示两段）。

## 做什么

1. 三处改为**拆组件**：外层只做 `tickEnabled` 判定；不活跃 → 渲染 tick=0 的纯展示；活跃 → 渲染内部
   无条件调用 hook 的组件。保住"非活跃态 0 订阅 1Hz"的原性能意图。
2. 新增回归用例 `frontend/app/session-overview/agent-status-chip-hooks.test.tsx`：
   同一实例 idle→working 翻转期间不得出现任何 hook 顺序信号，且翻转后 DOM 正确。
3. `App` 根加 ErrorBoundary 兜底：render 异常渲染成错误卡片（错误信息 + Reload 按钮），不再整窗白屏。

## 不做什么

- 不改 `agent-status-derive` / `agent-status-view` / `agent-status-chip-view` 等纯函数判定层。
- 不改 `agentStatusSecondTickAtom` 的 1Hz 节奏与订阅者范围。
- 不动 `session-overview.tsx:543 useSessionOverviewCacheRevision`：`channel` 每个调用点都是字面量常量，
  渲染间不翻转，hook 数稳定（已人工确认，非同类 bug）。
- 不做视觉/布局调整，不碰样式文件。

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/agent-status-chip-hooks.test.tsx --reporter=dot && echo HOOKS_OK` → `HOOKS_OK`
      （修复前必须红，红证见 `loop/red/N-1109-agent-chip-conditional-hook.txt`）
- [ ] `npx vitest run frontend/app/session-overview frontend/app/agent-status frontend/app/view/aisessions --reporter=dot && echo SUITE_OK` → `SUITE_OK`
- [ ] `npx tsc --noEmit 2>&1 | findstr /C:"error TS" | find /c /v ""` → `<= 47`（基线 47；`scripts/check-tsc-baseline.mjs` 在 Windows 上 `spawnSync npx ENOENT`，当前不可用，见 loop item 记录）
- [ ] 兜底：人为让某个 render 抛错，窗口显示错误卡片而不是空白（已由 `root-error-boundary.test.tsx` 覆盖）
- [ ] **真机验证由 nita 自行完成**（G7）：装好带本次修复的构建后，agent 状态 idle→working 翻转时窗口不白屏，
      `C:\temp\snork-chromium-124.log` 无 `React error #310`。子 agent 的 dev 实例验证已按用户要求取消。

## G1 签字

（bug 类不走 G1；本节仅为 prdHash 锚点。）
