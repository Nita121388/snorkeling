# CommonText 发送目标弹层紧凑化：目标卡 + 三个选择器常显 + 目录候选随 Tab

## Goal

CommonText 弹窗里的「发送」目标选择弹层（`SendTargetPanel`）当前是真机实测 **380×379px** 的 6 段平铺表单：
同一决策（发到哪里）出现 3 次（chip / 段内摘要 / 确认行），三个段头各带一个 mono hint，
聚焦块模式下不可变的 Agent/Type/Folder 三段仍占 203px；同时目录候选只来自当前挂载块，**不随所选 Tab 变化**。

本次把它压到 **≈300px**，并把目录候选改为按所选 Tab 收集（与「新建到那个 Tab」的语义一致）。

设计原型：`design/prototypes/commontext/commontext-send-compact/`（▲ 设计活跃，v2 已评审）

## Requirements

### R1 信息架构：目标只表达一次

- 顶部「选择目标」= 两枚 chip（聚焦块 / 新建）+ 一张**目标卡**：agent logo、落点文案（`聚焦块 · Codex` / `新建 · Codex`）、
  次级行（Tab · 目录）、状态徽标（`已存在` / `将新建`）。
- **删除**确认行左侧的重复摘要；目标信息在弹层内只出现一次。
- **删除**三个段头的右侧 mono hint（`二选一` / `默认 = 当前 Tab` / `默认 = 聚焦块目录`），默认值改由行尾 10px 文本
  （`当前` / `已选` / `自动`）与 `title` tooltip 表达。

### R2 三个选择器常显

- Agent / Tab / 目录三行**永远可见**，不因「聚焦块」模式隐藏、不默认折叠。
- 三行统一为「32px 行首标签 + 控件 + 行尾操作按钮」：Agent 图标行、Tab 下拉（`+` 新建 Tab）、目录下拉（`⋯` 浏览）。
- 在「聚焦块」模式下修改任意一项 → chip 自动切到「新建」（与 `preview.kind` 判定一致）。
- 可选折叠（B 档）本期**不实现**，只保留常显形态。

### R3 目录候选随所选 Tab

- 候选数据源改为 `collectAgentLaunchTargetsInTab(targetTab, …)`（复用 `agent-launch.ts` 既有能力），
  按 `config.tab` 决定目标 Tab：
  - `current` → 当前静态 Tab；
  - `existing` → 该 `tabId` 的 Tab；
  - `new` → 无块候选，只有工作区 cwd / home。
- 目录下拉首项固定为「跟随该 Tab（自动）」，其后是该 Tab 打开块的 cwd（带来源说明）。
- **切 Tab 时把 `folder` 重置为 `null`**（= 跟随所选 Tab），避免「选了 A Tab 却在 B Tab 的目录下建块」。
- `folder: null` 语义扩为「跟随所选 Tab」；`current` 时与「跟随聚焦块」等价，`resolveSendTarget` 的 existing 判定不变。

### R4 文案最小化（用户原则）

- 如果 UI 已通过控件本身表达了功能，**不额外加描述文本**。
- 具体删除：目录行下方的「目录候选来自 … 打开的块」说明行、后台执行行的右侧说明
  （`不跳转 · 后台注入` / `发送后跳转过去`）、目标卡下的「均跟随聚焦块」类说明。
- 必要的状态才保留：`当前` / `已存在` / `将新建` / `自动` / `已选`，且一律用行尾小字或徽标，不新增句子。
- 主按钮文案承载落点（`发送到聚焦 Codex` / `新建 Codex 并发送`）。

### R5 行为不变

- `resolveSendTarget` / `previewSendTarget` 判定逻辑、existing/create 分支、后台执行（`background`）、
  pending input 排队与注入链路**零改动**。
- 不新增 atom；不改 SplitButton 契约。

## Acceptance Criteria

| # | 判据 | 命令 → 期望 |
|---|---|---|
| A1 | 单测全绿 | `npx vitest run frontend/app/commontext` → all pass |
| A2 | i18n 齐平 | `npm run i18n:check` → exit 0 |
| A3 | 类型检查 | `npx tsc --noEmit -p tsconfig.json`（或项目既有 tsc 入口）→ 无新增错误 |
| A4 | 真机：三行常显 | `node scripts/verify/commontext-send-agent-block/verify.mjs --dry` 通过；补断言：聚焦块模式下 `[data-commontext-agent-row]`、Tab 行、目录行都在 |
| A5 | 真机：切 Tab 换候选 | 同一验证台：切到另一 Tab 后，目录下拉候选集合变化且已选项回到「自动」 |
| A6 | 弹层高度 | 验证台采样 `[data-split-button-menu]` 高度：聚焦块模式 ≤ 320px（基线 379px） |
| A7 | 无冗余文本 | 面板 DOM 文本快照中不含 `二选一` / `默认 =` / `目录候选来自` / `不跳转` 等描述句 |

## Out of Scope

- 折叠档位（B 档）与折叠状态持久化。
- 发送时机（立即/定时）与定时任务。
- SplitButton 弹层外壳与 z-index 层叠规则。
