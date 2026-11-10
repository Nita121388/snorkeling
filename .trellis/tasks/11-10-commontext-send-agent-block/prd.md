# CommonText Send 目标选择器：Agent Block 专属 + Agents/Type/Folder + pending input 注入

## Goal

CommonText 弹窗的 Send 从「发给当前聚焦终端」升级为**目标选择器**：

1. 目标是 **Agent Block 专属**（`view=term` 且带 `agent:provider` meta），普通终端不再作为 Send 目标。
2. 目标行展示该块 **agent card 信息**（头像 / 标题 / provider·model / 状态 / cwd）。
3. 目标配置是三项正交选择：**Agents**（profile）、**Type**（Tab：默认当前 Tab，其他 Tab 可选，`+` 新建 Tab）、**Folder**（项目目录 cwd，默认聚焦块目录）。
4. 底部确认按钮（文案固定「发送」）执行；解析规则：三项全等于聚焦块 → **直接注入聚焦块**；否则 → **按所选 Tab + Folder 新建 agent block**，文本作为 pending input 排队，TUI 就绪后自动注入 —— 用户不需要等 agent 加载。

## 背景与现状（2026-11-10 调研）

- 现状 Send 走 `sendTextToFocusedTerm`（聚焦 term → 本 Tab 存活 term 兜底），只面向**已存在且已加载**的终端。
- 发给 agent 的完整手工链路：WidgetsBar → New Agent → 等 TUI 启动 → 聚焦 → 开 CommonText → Send。
- 可复用积木齐全：`agent-launch.ts`（`getAgentProfileOptions` / `createAgentBlockDefForProfile|ForTarget` / `resolveAgentBlockCommandForLaunch`），`global.createBlock`，`services.ObjectService.CreateBlockInTab / CreateBlockInNewTab`。
- 坑：meta 键 `cmd:initialinput` 全仓库零消费点（`docs/project/agent-session-plan.md` 评审已点名），**不得依赖**。

## Requirements

- **R1 Send 目标选择器**：Compose 弹窗编辑器 footer 与详情 footer 的 Send 改为 split button（主键按当前配置直接发送 + caret 打开 popover）。列表行 Send 直接按当前配置发送（v1，不弹 popover）。
- **R2 只有 Agent Block 可作为「已存在」目标**：判定 = block `view === "term"` 且 meta 含 `agent:provider` 非空。聚焦块是普通终端时，聚焦行禁用并给出提示。
- **R3 目标展示 agent card**：头像（按 provider 着色/首字母）、标题、`provider · model`、cwd、状态 chip（沿用 `AgentStatusChip`/现有状态读取），不得新增第二份头像/状态映射。
- **R4 三项正交选择**：
  - Agents：来自 `getAgentProfileOptions(settings)`。
  - Type：当前 Tab（默认）→ 其他 tab 列表 → `+` 新建 Tab。
  - Folder：默认聚焦块 `cmd:cwd`（无聚焦 agent 时取当前 workspace context cwd）；候选 = 本 Tab 内 agent/term 块 cwd 去重 + 当前 workspace cwd + home；支持「浏览…」选择任意目录（无可用时隐藏）。
- **R5 解析与执行**（纯函数判定）：Agents == 聚焦块 provider 且 Type == 当前 Tab 且 Folder == 聚焦块 cwd → 注入聚焦块（走 `sendTextToFocusedTerm` 同路径语义）；其他组合 → 新建。
- **R6 新建执行**：`createAgentBlockDefForProfile(profile, settings, {connection, cwd})` → `resolveAgentBlockCommandForLaunch` → 目标 Tab：当前 Tab 用 `createBlock`；已有 Tab 用 `ObjectService.CreateBlockInTab`；新 Tab 用 `ObjectService.CreateBlockInNewTab`。成功后 `registerPendingInput(blockId, text)`。
- **R7 pending input 注入**：按 blockId 排队；term 视图在 TermWrap 挂载后等待「收到输出 + 输出静默窗口（默认 600ms）」经 `terminal.paste()` 注入（bracketed paste 语义保留）。TTL 60s 到期未注入 → 回退写剪贴板 + 可见提示，不静默丢失。
- **R8 失败可见**：建块失败 / 注入超时 / 无可用目录等都以弹窗内 status 行呈现，不静默。
- **R9 单测**：解析纯函数、agent block 判定、pending input 队列（登记/消费/TTL/覆盖）全覆盖。

## Non-goals（本轮不做）

- model / vendor 选择器（沿用 profile 默认 model）。
- 选择「其他已存在的 agent block」（只认聚焦块；其他块需先聚焦）。
- 后端 / Go 改动（纯前端）。
- 列表行 Send 弹 popover（v1 用当前配置直发）。
- Tab 分组 / workspace 切换选择。

## Acceptance Criteria（机器可判定）

1. `npx tsc --noEmit -p tsconfig.json` → exit 0（或项目既有基线不新增报错）。
2. `npx vitest run frontend/app/commontext` → 0 fail，且新增测试文件覆盖 R5/R7/R2。
3. `npx eslint frontend/app/commontext --max-warnings 0` → exit 0。
4. 生产代码中不存在 `cmd:initialinput` 依赖（`rg "cmd:initialinput" frontend/app` 仅允许注释说明，不得作为读取点）。
5. 手动验证（真机，CDP）：聚焦 agent block → Send 主键 hint 显示「聚焦 X」→ 点击后文本进入该 TUI 输入区。
6. 手动验证：改 Agents 或 Type 或 Folder → 底部摘要变「新建 …」→ 点击发送后目标 Tab 出现新 agent block，TUI 就绪后文本自动出现。
7. 聚焦普通终端 → popover 聚焦行禁用并显示提示；仍可通过新建路径发送。
8. `verif`：新增/更新 `docs/project/verify-ledger.md` 一行结论（area = commontext-send-agent-block）。

## Constraints

- 复用现有积木：不得新增第二份 agent 建块路径 / 头像映射 / 状态映射。
- 不引入新依赖。
- 所有新组件 ≤ 既有 modal 复杂度，样式走现有 token（不硬编码颜色）。
- 设计依据：`design/prototypes/commontext/commontext-send-agent-block/`（README 状态 ▲）。

## Open Questions（实现期默认取值，均可回退）

- pending input 静默窗口默认 600ms，`agent:provider` TUI 冷启动慢时靠 TTL 兜底。
- Folder「浏览…」用 Electron `showOpenDialog({properties:["openDirectory"]})`，不可用时隐藏该项。
