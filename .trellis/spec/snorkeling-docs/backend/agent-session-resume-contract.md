# Agent 会话 resume 契约（前端 meta ↔ 后端派生）

> 适用范围：前端 `frontend/app/workspace/agent-split.ts`、`frontend/app/store/global.ts`；
> 后端 `pkg/blockcontroller/shellcontroller.go`（`resolveAgentCmdAndArgs` / `getAgentProvider`）。
> 来源：2026-10-22 `agent-split-new-session` 任务——Agent TUI 水平/垂直拆分后，新块与源块
> 共用同一个 agent 会话（两份对话历史互相串、Session Outline 指向同一 session）。

## 1. Scope / Trigger

这条契约在**任何"拿已有 block meta 去开新块"的路径**上生效，不只是拆分：

- 水平 / 垂直拆分（term 右键菜单、block header 拆分按钮）
- 任何未来新增的"复制块 / 模板化放置"入口

**触发判据只有一个**：新块的 meta 里带不带 agent 身份（`agent:autoresume` /
`agent:provider` / `agent:sessionid`）。

## 2. Signatures

```ts
// 前端（frontend/app/workspace/agent-split.ts，纯函数）
export function isAgentBlockMeta(meta?: MetaType | Record<string, unknown>): boolean
export function resolveAgentProvider(meta?: MetaType | Record<string, unknown>): string
export function stripAgentResumeArgs(provider: string, args: string[]): string[]
export function buildSplitBlockDef(blockDef: BlockDef): BlockDef
```

```go
// 后端（pkg/blockcontroller/shellcontroller.go）—— 唯一决定 resume 参数的地方
func resolveAgentCmdAndArgs(blockId string, blockMeta waveobj.MetaMapType,
    isLocalConn bool, localHomeDir string) (string, []string, *AgentRunInfo, error)
```

## 3. Contracts

### 3.1 后端：resume 完全由 meta 派生

`agent:autoresume=true` **且** `agent:sessionid` 非空时，后端按 provider 前置 resume 参数：

| provider | 有 `agent:sessionid` | 无 `agent:sessionid` |
|---|---|---|
| codex | `resume <id>` + `stripCodexResumeArgs` | 本地连接时扫 `~/.codex/sessions` 捕获新 id 写回 block meta |
| claude | `--resume <id>` + `stripClaudeSessionArgs` | 后端铸 uuid → `--session-id <uuid>` |
| opencode | `--session <id>` | 不注入（天然新会话） |
| pi | `--session-id <id>` | 后端铸 uuid → `--session-id <uuid>` |

**推论：meta 里没有 `agent:sessionid` 就一定不会 resume。** 后端不需要为"新会话"做任何
特殊处理——这是本次修复能保持后端零改动的前提。

### 3.2 前端：拆分原语是唯一改写点

`createBlockSplitHorizontally` / `createBlockSplitVertically`
（`frontend/app/store/global.ts`）在 `ObjectService.CreateBlock` 前套一层
`buildSplitBlockDef(blockDef)`。

- 判据只看**新块自身**是不是 agent 块，与源块无关
- agent 块 → 删 `agent:sessionid`、剥 `cmd:args` 里的 resume 参数
- 非 agent 块 → meta 逐字段等价拷贝，零行为变化

### 3.3 保留什么（改写只动会话身份）

保留：`agent:autoresume: true`、`agent:provider`、`cmd`、`cmd:env`、`cmd:cwd`、`cmd:jwt`、
`cmd:runonstart`、`connection`、`agent:requestedmodel`、`agent:*vendorid`、`agent:*vendorname`、
`agent:isolationmode`。

→ 新块以**同 provider / 同模型 / 同厂商 / 同 cwd / 同连接**起一个**全新会话**；
`agent:autoresume` 保留意味着新块日后重启时 resume 的是**它自己的**会话。

### 3.4 前端剥离规则（与后端既有函数语义对齐）

| provider | 剥离内容 | 对齐的后端函数 |
|---|---|---|
| codex | `resume <id>` 子命令及其 id；`--last` / `--all` / `--include-non-interactive` | `stripCodexResumeArgs` |
| claude | `--resume` / `-r` / `--session-id`（连同取值）、`--continue` / `-c` / `--fork-session` | `stripClaudeSessionArgs` |
| opencode | `--session`（连同取值） | `ensurePiSessionIdArg` 的 pin 列表 |
| pi | `--session-id` / `--session` / `--resume` / `-r` / `--fork`（连同取值） | `ensurePiSessionIdArg` |
| 未知 | 保守通用：`--resume` / `-r` / `--session` / `--session-id`（含 `--flag=value`）及其取值、`resume <id>` 子命令 | — |

provider 判定优先级：`agent:provider`（trim + 小写）→ `cmd` 的 basename
（`\`→`/`、取最后一段、去 `.exe/.cmd/.bat/.ps1`、小写），与后端 `getAgentProvider` 一致。

## 4. Validation & Error Matrix

| 情况 | 行为 |
|---|---|
| 新块 meta 缺失 / 不是 agent 块 | meta 等价拷贝，**不做任何改写** |
| `cmd:args` 剥完为空数组 | **删除 `cmd:args` 键**（不能传 `cmd:args: []` 给后端） |
| `agent:provider` 缺失 | 退回 `cmd` basename 判定；仍判不出则走通用保守剥离 |
| provider 未知（如 gemini / 自定义 CLI） | 走通用保守剥离；**不得**因为"认不出"就跳过剥离（残留的 `--resume` 会静默 resume 旧会话） |
| codex 的 `resume <id>` 定位 | 必须按选项表跳过取值，否则会把 `--cd /tmp` 的 `/tmp` 误当 session id |

## 5. Good / Base / Bad Cases

- **Good**：拆分 codex agent 块 → 新块 meta 无 `agent:sessionid`、`cmd:args` 无 `resume`；
  源块 meta 与会话不变。
- **Base**：拆分普通终端块（`view:term` + `controller:shell`）→ meta 与今天完全一致。
- **Bad**：拆分时原样复制 `agent:sessionid` → 新块与源块共用同一会话（本次修掉的 bug）。
- **Bad**：为了"新会话"去改后端加 `agent:freshsession` 标志位 → 前后端双改 + 标志残留状态机
  （重启时若标志没清干净会再新建一次会话），过度设计。

## 6. Tests Required

`frontend/app/workspace/agent-split.test.ts`（vitest）必须覆盖：

1. `isAgentBlockMeta`：三个判据各命中一次 + 非 agent 块全不命中
2. `resolveAgentProvider`：meta 优先 / `cmd` basename 兜底 / 未知
3. `stripAgentResumeArgs`：4 个 provider 各 2 种以上参数形态 + 未知 provider 通用形态
4. `buildSplitBlockDef`：非 agent 块等价、agent 块删 sessionid 且保留其余、剥空后删 `cmd:args` 键
5. 纯函数性：传入的 blockDef / meta / args 数组不被原地修改

回归口径：`npx vitest run frontend/app/workspace frontend/app/view/term frontend/app/store`。

## 7. Wrong vs Correct

```ts
// ❌ Wrong：整份复制源块 meta → 新块带 sessionid → 后端给它拼 resume → 与源块同会话
const newBlockId = await ObjectService.CreateBlock(blockDef, rtOpts);

// ✅ Correct：拆分原语统一改写成"新会话"形态（内部只动会话身份）
const newBlockId = await ObjectService.CreateBlock(buildSplitBlockDef(blockDef), rtOpts);
```

```ts
// ❌ Wrong：把"主动打开某个会话"的路径也改了 → 用户选的会话 resume 不掉了
async function createBlock(blockDef: BlockDef) { /* ... */ }   // 不要动

// ✅ Correct：createBlock 保持原样，只有两个 split 原语改写
async function createBlockSplitHorizontally(blockDef, targetBlockId, position) { /* 用 buildSplitBlockDef */ }
```

## 8. 不要动的地方

- `createBlock` / `replaceBlock`（`frontend/app/store/global.ts`）——「主动打开会话」路径，
  必须保留 resume 语义。`restoreMetaForSession`（`frontend/app/view/aisessions/utils.ts`）
  的所有调用点都走 `createBlock`。
- 键盘快捷键拆分（`frontend/app/store/keymodel.ts`）—— 走 `getDefaultNewBlockDef()`，
  产出的是普通 shell 终端（本来就不是 agent 块）。
