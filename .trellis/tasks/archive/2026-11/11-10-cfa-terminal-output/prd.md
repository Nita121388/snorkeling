# 终端块失败输出：复制给 agent

> 父任务：11-10-copy-for-agent
> 依赖：cfa-core

## Background

最高频的「解释半天」场景：终端里一条命令失败（非零退出码），用户把输出截一半发给 agent，
还要口述「我跑了个 xxx 然后报错了」。终端块已持有完整输出（scrollback）、命令行、cwd、
退出状态——`frontend/app/view/term/` 与 block 模型里都有，缺的只是一个出口。
现有最近似实现是 `frontend/app/block/blockframe-header.tsx:202` 的复制 error+stack（裸文本、
无 Task、无契约、只覆盖块加载错误，不覆盖命令失败）。

## Goal

命令非零退出后，终端块头部（或失败提示条）出现 `Copy for agent`：复制末 N 行输出 + 命令行 +
退出码 + cwd，agent 拿到即可定位。

## Requirements

### R1 失败检测与入口

- 命令退出码 ≠ 0 时，终端块头部工具区出现 `<CopyForAgent>`（与既有块头按钮同排）；
  退出码 = 0 或仍在运行时不渲染。
- 入口常驻于块头而非输出尾部：输出可能在滚动，按钮不能跟着滚走。

### R2 payload

- Context：`command`（完整命令行）、`cwd`、`exit code`、末 N 行 stdout/stderr 合并输出
  （默认 N=40，上限 200；超出时头部标注 `… (truncated, full scrollback: M lines)`）。
- Task："Diagnose why this command failed and name the smallest fix."
- Output contract：`FIX_COMMAND_ONLY`（一句话结论 + 修复命令）。
- 输出含 ANSI 控制序列时先剥离（复用 term 既有 strip 逻辑，若无则本任务内最小实现并单测）。

### R3 单测

- 失败/成功/运行中三态按钮渲染断言（成功与运行中不渲染）。
- 截断：>N 行时头部含 truncated 标注且行数 = N。
- ANSI 剥离用例 ≥ 2（颜色码、清屏序列）。

## Acceptance（命令 → 期望输出）

- [x] `npx vitest run frontend/app/view/term/agent-failure-copy.test.ts` → 10/10 全绿（≥ 5）：三态判定（失败/成功/运行中/非 cmd 块）、ANSI 剥离 ≥ 4 例（SGR / 清屏+光标 / OSC 两种结尾）、截断与 N 钳制、payload 证据字段与三段式。
- [x] 真机跑真实失败命令（`sh -c 'echo boom-verify-line; exit 3'`）→ 点复制：payload 含 `command:` / `cwd:` / `exit code: 3` / 末段输出 / `### Task` / `### Output contract`；行数 ≤ 200（真实 12 行）。
- [x] 真机验证台：新 area `scripts/verify/term-failure-copy/verify.mjs` → **11/11 全绿**（launch+reset），台账已记；area 已登记 README。

## 实施偏离（2026-11-10）

- 入口位置：`HeaderElem` 不支持任意 React 组件，若改类型/渲染器会出界；PRD 本身允许「失败提示条」备选，所以实现为终端块内右上角的**常驻覆盖条**（`data-term-failure-copy`，不随输出滚动，满足「不能跟着滚走」的硬要求），而非块头工具区。
- `command` 取 `cmd` + `cmd:args` 拼接：真机验证发现只拼 args 会丢掉可执行文件名（payload 里成了 `-c echo ...`），已修。

## Touch（白名单）

- `frontend/app/view/term/term.tsx`（或其头部工具区组件）
- `frontend/app/view/term/agent-failure-copy.ts`（新，payload 构建）
- 对应测试文件

## Out of Scope

- 自动重跑 / 自动修复建议展示。
- 长输出全量导出（文件级 export 另议）。
