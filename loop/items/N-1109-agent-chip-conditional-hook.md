---
id: N-1109-agent-chip-conditional-hook
title: "Agent 状态 chip 条件调用 hook 导致整窗白屏（React #310）"
type: bug
priority: P0
status: open
origin: self
source: "nita 2026-11-09 报：123/124 整窗突然白屏只能重启；CDP 现场捕获 React #310"
task: 11-09-agent-chip-conditional-hook
order: 100
touch: [frontend/app/session-overview/**, frontend/app/agent-status/**, frontend/app/view/aisessions/session-run-badge*, frontend/app/app.tsx, frontend/app/element/errorboundary.tsx, docs/project/verify-ledger.md, .trellis/tasks/11-09-agent-chip-conditional-hook/**, .trellis/spec/**]
rollback: "git revert 单提交；三处改动均为 hook 调用位置调整，无数据/接口变更"
budget: {minutes: 90, retries: 2}
releaseCandidate: false
createdAt: "2026-11-09T01:50:49Z"
---

# Agent 状态 chip 条件调用 hook 导致整窗白屏（React #310）

## 背景

`0.0.123` / `0.0.124` 上出现"整窗突然白屏、切 tab 无效、只能重启"。
2026-11-09 用 CDP 在现场（Overview tab，09:45:32 渲染 → 09:45:39 抛错 → 09:45:40 `#main` 子节点 0）抓到：

```
Uncaught Error: Minified React error #310
  at updateWorkInProgressHook            (index-rkLQ8bG-.js:241835)
  at Object.updateReducer [as useReducer] (index-rkLQ8bG-.js:241894)
```

React #310 = "Rendered more hooks than during the previous render"。三处把
`useAtomValueSafe(agentStatusSecondTickAtom)` 写在 `tickEnabled ? ... : 0` 里，
status 从 idle 翻到 working 时 hook 数 +1；`useAtomValueSafe` → jotai `useAtomValue` →
内部 `React.useReducer`（与栈一一对应）。App 根没有 ErrorBoundary → React 卸载整棵树 → 整窗白屏
（light 主题 `--main-bg-color: #f2eee5`，所以是米白而不是黑）。

修法：新增 `useAgentSecondTick(enabled)`（订阅永不变化的 `IdleTickAtom` 兜底，hook 数量恒定），
三处调用点改用它；另给 App 根加 `RootErrorBoundary`，以后任何 render 异常只出错误卡片。

## 来源

- self：nita 2026-11-09 报：123/124 整窗突然白屏只能重启；CDP 现场捕获 React #310

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/agent-status-chip-hooks.test.tsx --reporter=dot >nul 2>&1 && echo HOOKS_OK` → `HOOKS_OK`
- [ ] `npx vitest run frontend/app/session-overview frontend/app/agent-status frontend/app/view/aisessions --reporter=dot >nul 2>&1 && echo SUITE_OK` → `SUITE_OK`
- [ ] `npx tsc --noEmit 2>&1 | findstr /C:"error TS" | find /c /v ""` → `<= 47`

## 记录

- 红证：`loop/red/N-1109-agent-chip-conditional-hook.txt`（修复前用例 2 失败，信号
  `Internal React error: Expected static flag was missing.` —— prod 构建同一分支即 #310）
- 修复后：同一用例 3 passed；`RootErrorBoundary` 另有 2 passed。
- 真机验证：见 `.trellis/tasks/11-09-agent-chip-conditional-hook/` 与 verify-ledger。
- 顺带发现（未在本包修，属 scripts/ 白名单外）：`scripts/check-tsc-baseline.mjs` 用
  `execFileSync("npx", ...)` 在 Windows 报 `spawnSync npx ENOENT`（需 shell:true），
  该脚本当前不可用，本次改用 `npx tsc --noEmit` + `find /c` 计数对齐基线 47。
