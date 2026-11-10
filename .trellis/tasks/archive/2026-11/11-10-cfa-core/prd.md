# CopyForAgent 共享件与 payload 三段式契约

> 父任务：11-10-copy-for-agent
> 依赖：无（本任务是后续 5 个消费面的 P0 前置）。

## Background

「复制给 agent」已有三份实现、三套格式（见父任务 PRD 的对照表）。输出契约（"Reply with the
merged content only"）只存在于 `pkg/syncconflict/render.go`；前端 `conflict-copy.ts` 与
`connstatusoverlay.tsx` 都没有。没有契约，agent 默认输出一篇分析而不是可直接回填的内容。

## Goal

一个共享组件 + 一个构建器，让后续消费面只拼 Context，Task 与 Output contract 由构建器统一追加，
格式不可能长歪。

## Requirements

### R1 `buildAgentPayload()` 构建器

- 签名：`buildAgentPayload(opts: { context: string; task: string; outputContract: string | AgentOutputContract })`
  → `string`，三段以 `### Task` / `### Output` 等小节标题组装（对齐 `syncconflict/render.go`
  既有小节结构，Go 端与 TS 端视觉一致）。
- 输出契约不允许各面自造长句：导出常用预设常量（`MERGED_CONTENT_ONLY`、`FIX_COMMAND_ONLY`、
  `DIAGNOSIS_BRIEF`），自定义需在调用点给出理由注释。
- Context 段保持调用方拼装（各面数据源差异大，不抽象数据形状）。

### R2 `<CopyForAgent>` 组件

- 基于 `element/copybutton.tsx`，文案 `Copy for agent`，`title` 必填（如 `Copy all 3 conflicts for an AI to merge`）。
- props：`text: string | (() => Promise<string>)`（懒取 RPC 数据时用函数形态，复制期间显示
  loading 态，失败不假报成功——沿用 CopyButton 的 Promise 语义）。
- 失败态：静默保持原图标（CopyButton 既有行为），不 toast。
- 样式：与 `.btn` 文本按钮同档，含 `fa-clipboard` 系图标。

### R3 单测

- `buildAgentPayload`：三段组装、缺失 task/outputContract 时 throw（宁可编译期失败也不产出没契约的文本）。
- `<CopyForAgent>`：渲染、点击成功反馈、Promise reject 不假报成功（对齐 copybutton.test.tsx 既有断言方式）。

## Acceptance（命令 → 期望输出）

- [x] `npx vitest run frontend/app/element/copy-for-agent.test.tsx` → 全绿，9 个用例（≥ 6）；copybutton 回归 6/6 同跑全绿。
- [x] `grep -rn "buildAgentPayload" frontend/ | wc -l` ≥ 1（构建器落位 agent-payload.ts + copy-for-agent.tsx re-export）；core 任务本身不接消费面。
- [x] `grep -rn "Output contract\|### Output" frontend/app/element/copy-for-agent.ts*` → 三段式小节头在组件注释中声明，字符串常量仅在 agent-payload.ts 一处定义（`"### Output contract"` L59）。
- [x] `npx tsc --noEmit` 新增/改动文件 0 error（仓内存量 47 处不计）。

## Touch（白名单）

- `frontend/app/element/copy-for-agent.tsx`（新）
- `frontend/app/element/copy-for-agent.test.tsx`（新）
- `frontend/app/element/agent-payload.ts`（新，构建器）
- 如 CopyButton 需要暴露 loading 态：`frontend/app/element/copybutton.tsx`（小改）

## Out of Scope

- 任何消费面接线（后续子任务）；Go 侧渲染不动。
