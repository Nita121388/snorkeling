# Design — Agent TUI 拆分 = 新会话

## 1. 问题定位

拆分 agent 终端块时，新块整份复制源块 meta。源块 meta 在 agent 首次启动后已被后端
写入 `agent:sessionid`（`pkg/blockcontroller/shellcontroller.go:1214` `persistAgentSessionId`）。
后端启动进程时按 meta 派生 resume 参数（`shellcontroller.go:957` `resolveAgentCmdAndArgs`）：

```
agent:autoresume=true && agent:sessionid != ""
  → codex    : resume <id>      (前置)
  → claude   : --resume <id>   (前置)
  → opencode : --session <id>   (前置)
  → pi       : --session-id <id>(前置)
```

于是新块与源块 resume 同一会话。**根因不在后端**：后端行为是「meta 驱动」的，
meta 里没有 sessionid 就不会 resume。根因是**拆分时把会话身份一起复制了**。

## 2. 方案选择

| 方案 | 做法 | 结论 |
|---|---|---|
| **A（采用）** | 前端在共享拆分原语处改写**新块** meta：剥会话身份，保留其余配置 | ✅ 单一落点、纯前端、后端零改动、可单测 |
| B | 前端打 `agent:freshsession` 标志，后端首次 spawn 时忽略 sessionid 并清标志 | ❌ 前后端双改 + 标志残留状态机（重启误建新会话），过度设计 |
| C | 菜单里另加「New Agent Session (Split)」入口 | ❌ 入口不一致（header 图标 / 快捷键仍 resume），治标不治本 |

## 3. 架构

```
                       ┌──────────────────────────────────────────┐
term-model.ts          │  createBlockSplitHorizontally / Vertically │  (store/global.ts)
blockframe-header.tsx ─▶        （共享拆分原语，唯一改写点）        │
                       └───────────────┬──────────────────────────┘
                                       │ buildSplitBlockDef(blockDef)
                                       ▼
                       ┌──────────────────────────────────────────┐
                       │  frontend/app/workspace/agent-split.ts   │  ← 纯函数，无副作用
                       │  · isAgentBlockMeta(meta)                │
                       │  · resolveAgentProvider(meta)            │
                       │  · stripAgentResumeArgs(provider, args)  │
                       │  · buildSplitBlockDef(blockDef)          │
                       └──────────────────────────────────────────┘
                                       │ 产出 meta
                                       ▼
                       ObjectService.CreateBlock(blockDef) → 后端按新 meta 起进程
```

### 为什么落在拆分原语而不是各调用点

`createBlockSplitHorizontally` / `createBlockSplitVertically` 是**所有**拆分路径的公共出口
（term 右键菜单、header 图标按钮、preview 拆分、aisessions 详情块、quick launch）。
在这里改写 = 一次改动覆盖全部入口，且未来新增入口自动受益。

### 为什么判定看「新块」而不是「源块」

- 拆分动作的语义是「拿这个 blockDef 去开一个新块」；
- 有些拆分的新块**根本不是** agent 块（preview / aisessions 详情块 / 普通终端），
  这些绝不能被误改；
- 有些拆分的新块**是** agent 块但源块不是（理论上）——也应按新块语义处理。

结论：判据 = **新块自身是不是 agent 块**。

## 4. 契约

### 输入
```ts
type BlockDef = { meta?: MetaType & Record<string, unknown> };
```

### 输出（agent 块）
```ts
{
  meta: {
    ...原 meta,
    "agent:sessionid": undefined,       // 删除（undefined 会在 JSON 序列化时消失）
    "cmd:args": [...剥离后的参数],        // 无 resume 参数时保持原样/删除空数组
    "agent:autoresume": true,           // 保留
    "agent:provider": "<provider>",     // 保留
    // 其余（cmd / cmd:env / cmd:cwd / connection / vendor / model）原样保留
  }
}
```

### 输出（非 agent 块）
```ts
{ meta: { ...原 meta } }   // 逐字段等价，零行为变化
```

## 5. provider 判定

优先级：

1. `meta["agent:provider"]`（小写去空白；除 codex/claude/opencode/pi 外的一律当作"未知"）
2. `meta["cmd"]` 的 basename：去目录分隔符 → 去 `.exe/.cmd/.bat/.ps1` → 小写

与后端 `getAgentProvider`（`shellcontroller.go:1026`）语义一致。

## 6. resume 参数剥离

与后端已存在的剥离函数**语义对齐**（不是发明新规则）：

- 后端 `stripCodexResumeArgs`（`shellcontroller.go:1174`）：去掉 `resume <id>` 与
  `--last` / `--all` / `--include-non-interactive`
- 后端 `stripClaudeSessionArgs`（`shellcontroller.go:1092`）：去掉 `--resume/-r/--session-id`（含值）、
  `--continue/-c/--fork-session`
- opencode / pi 后端是「前置」而非「剥离」，前端需主动剥掉已存在的
  `--session` / `--session-id` / `--resume` / `-r` / `--fork`，避免新块仍指向旧会话

未知 provider 走保守通用剥离：`--resume` / `-r` / `--session` / `--session-id`
（含 `--flag=value` 内联形态）及其后随值，以及 `resume <id>` 子命令。

## 7. 风险与兼容

| 风险 | 评估 | 处置 |
|---|---|---|
| 误伤非 agent 块 | 低 | 判据三重与（autoresume/provider/sessionid），普通终端 meta 全不命中 |
| 误伤 aisessions 主动 resume | 无 | 那些路径走 `createBlock` 或新块 meta 非 agent 形态；`restoreMetaForSession` 产出的 meta 含 `agent:sessionid` 但只用于 `createBlock`，不走拆分原语 |
| 后端行为变化 | 无 | 后端零改动 |
| codex 新块 sessionid 一时为空 | 预期内 | 与「从 Agent 面板新起一个 codex 块」完全同构：先无 id，扫盘捕获后写回 |
| 拆分后新块 cmd:args 为空数组 | 需处理 | 剥离后为空则**删除** `cmd:args` 键，避免 `cmd:args: []` 传给后端 |

## 8. 测试

`frontend/app/workspace/agent-split.test.ts`（vitest）：

- provider 判定：meta provider 优先 / cmd basename 兜底 / 未知
- codex：`["resume","abc"]` → `[]`；`["--model","gpt-5","resume","--cd","/tmp","abc"]` → `["--model","gpt-5","--cd","/tmp"]`
- claude：`["--resume","abc"]` → `[]`；`["-r","abc"]` → `[]`；`["--continue"]` → `[]`
- opencode：`["--session","abc"]` → `[]`
- pi：`["--session-id","abc"]` → `[]`；`["--fork","abc"]` → `[]`
- 非 agent 块：meta 逐字段等价
- agent 块：`agent:sessionid` 被删、`agent:autoresume`/`agent:provider` 保留、`cmd`/`cmd:cwd`/`cmd:env` 保留
- 未知 provider 通用剥离
- 不修改源对象（纯函数，不原地改传入 meta）
