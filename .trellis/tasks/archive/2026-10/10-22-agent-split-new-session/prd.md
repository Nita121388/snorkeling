# PRD — Agent TUI 水平/垂直拆分应新建 agent 会话而非 resume 原会话

## 背景

Agent 终端块（term 视图里跑 codex / claude / pi / opencode 的块，俗称「Agent TUI」）
在终端右键菜单、block header 拆分按钮上做水平/垂直拆分时，行为是错的。

### 现状链路（证据）

| 环节 | 位置 | 行为 |
|---|---|---|
| 拆分复制整份 meta | `frontend/app/view/term/term-model.ts:1375-1393`（右键 Split H/V）<br>`frontend/app/block/blockframe-header.tsx:277-310`（header 拆分按钮） | `meta: blockData?.meta` —— 整份复制，含 `agent:sessionid` |
| 后端按 meta 注入 resume | `pkg/blockcontroller/shellcontroller.go:957` `resolveAgentCmdAndArgs` | `agent:autoresume=true` 且 `agent:sessionid` 非空 → codex 拼 `resume <id>`、claude 拼 `--resume <id>`、opencode 拼 `--session <id>`、pi 拼 `--session-id <id>` |
| sessionid 来源 | `pkg/blockcontroller/shellcontroller.go:1214` `persistAgentSessionId` | agent 跑起来后把 session id 写回 **block meta**（codex 扫盘捕获、claude/pi 后端铸 uuid） |

源块跑过一次后 meta 里已有 `agent:sessionid`；拆分把这份 meta 原样带走 →
后端给新块自动拼上 resume 参数 → **新块与源块 resume 同一个会话**：
两份对话历史互相串、Session Outline 指向同一 session、两边同时写同一份会话文件。

### 与「主动打开某个会话」的区别

`aisessions` 列表里点开一个会话、`restoreMetaForSession`
（`frontend/app/view/aisessions/utils.ts:347`）、会话详情块 —— 这些 resume 是**用户主动选的会话**，
必须保留。本次只改「拆分」这一条路径。

## Goal

拆分产生的新 agent 块 → 以**同 provider / 同模型 / 同 cc-switch 厂商 / 同 cwd / 同连接**
起一个**全新会话**；源块完全不受影响，仍是原会话。

## Requirements

### R1 — 判定「新块是 agent 块」

新块 meta 满足任一条件即视为 agent 块：

- `agent:autoresume === true`
- `agent:provider` 非空字符串
- `agent:sessionid` 非空字符串

### R2 — 拆分会话身份改写

新块是 agent 块时，拆分产出的 meta 必须：

1. **删除** `agent:sessionid`（新块不继承源块会话）
2. **剥离** `cmd:args` 中的 resume 类参数（按 provider 分别处理，见 R3）
3. **保留** `agent:autoresume: true` 与 `agent:provider` —— 新块仍是正规 agent 块，
   后端会为它**新铸/新捕获**一个 session id 写回它自己的 meta；今后重启它 resume 的是**它自己的**会话
4. **保留**其余全部 meta：`cmd`、`cmd:env`、`cmd:cwd`、`cmd:jwt`、`cmd:runonstart`、`connection`、
   `agent:requestedmodel`、`agent:*vendorid`、`agent:*vendorname`、`agent:isolationmode` 等

### R3 — resume 参数剥离规则

| provider | 剥离内容 |
|---|---|
| codex | `resume <id>` 子命令及其 id；`--last` / `--all` / `--include-non-interactive`（沿用后端 `stripCodexResumeArgs` 语义） |
| claude | `--resume <id>`、`-r <id>`、`--session-id <id>`、`--continue`、`-c`、`--fork-session` |
| opencode | `--session <id>` |
| pi | `--session-id <id>`、`--session <id>`、`--resume <id>`、`-r`、`--fork` |
| 未知 / 其他 | 保守通用：`--resume` / `-r` / `--session` / `--session-id`（含 `=` 内联形态）及其值、`resume <id>` 子命令 |

provider 判定优先级：`agent:provider` meta → `cmd` 的 basename（去掉 `.exe/.cmd/.bat/.ps1`，小写）。

### R4 — 改写落点收敛在拆分原语

改写发生在**共享拆分原语** `createBlockSplitHorizontally` / `createBlockSplitVertically`
（`frontend/app/store/global.ts:366` / `:389`），而不是散落在各个调用点。
规则只看**新块自身**是不是 agent 块，与「被拆分的源块」无关：

- 新块是 agent 块 → 改写成新会话形态（本次目标场景）
- 新块不是 agent 块（普通终端、preview、aisessions 详情块等）→ meta 原样不变，零影响

### R5 — 不改动的路径

- 键盘快捷键拆分（`frontend/app/store/keymodel.ts:421/431`）：现状走 `getDefaultNewBlockDef()`，
  产出的是**普通 shell 终端**（非 agent 块），本就不 resume，**保持现状不动**。
- `aisessions` 主动打开会话 / 会话详情块 / `restoreMetaForSession`：**保持 resume 语义不动**。
- 后端 Go 代码：**零改动**（后端 resume 完全由 meta 派生，meta 正确即行为正确）。
- 源块：**零改动**（只改写新块的 meta，不回写源块）。

## Acceptance Criteria

- [ ] 拆分 codex agent 块 → 新块启动命令不含 `resume`，起新会话；源块仍是原会话
- [ ] 拆分 claude agent 块 → 新块 `claude --session-id <新uuid>`，起新会话
- [ ] 拆分 pi agent 块 → 新块 `pi --session-id <新uuid>`，起新会话
- [ ] 拆分 opencode agent 块 → 新块起新会话
- [ ] 拆分普通终端块 → 行为与今天完全一致（meta 不被改写）
- [ ] 拆分后新块保留 provider / 模型 / vendor / cwd / connection
- [ ] 新块 `agent:autoresume` 仍为 true（重启 resume 自己的会话）
- [ ] 源块 meta 与会话不受影响
- [ ] vitest 单测覆盖：4 provider × 参数形态 + 非 agent 块不变 + provider 判定
- [ ] 现有前端测试无回归（`npx vitest run`）
- [ ] `docs/docs/agent-workflow.mdx` 补「拆分 = 新会话」行为说明

## Notes

- 决策（用户已确认按默认执行）：新块保留同 provider/模型/厂商/cwd；保留 `agent:autoresume`；
  快捷键拆分路径不动。
- 纯前端改动，不涉及后端 / 数据模型 / 配置键。
