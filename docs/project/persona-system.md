# Persona 系统 — 实现事实（A1：数据地基）

> 设计：`design/plans/persona-system.md`（§3.1 布局 / §3.2 gitignore / §4.5 写入纪律）
> 任务：`.trellis/tasks/11-12-persona-core/`（loop 包 `F-1112-persona-core-r2`）
> 状态：A1 / A1.5 / A2.5（CLI 部分）/ A3 已落地；A2/A4/A5/A5.5/A6 未开始

## 1. 代码位置

| 单元 | 文件 | 说明 |
|---|---|---|
| 数据模型 / 根目录 / slug | `pkg/persona/persona.go` | 仅标准库；无 DB、无 RPC |
| scaffold 生成器 | `pkg/persona/scaffold.go` | 15 个文件；`.persona/` 下 12 个 |
| 名册（L0） | `pkg/persona/roster.go` | `.index/PERSONAS.md`，原子替换 |
| rename | `pkg/persona/rename.go` | move + id 重写 + 名册重生成 |
| CLI | `cmd/wsh/cmd/wshcmd-persona.go` | `create/list/get/rename` |

## 2. 落盘事实

```
<root>/<id>/.persona/persona.json      schemaVersion=1，id=目录名
<root>/<id>/.persona/persona.local.json 本机专属（workdir/sync.mode）
<root>/<id>/.persona/CHARTER.md        唯一真源（人写）
<root>/<id>/.persona/MEMORY/           facts/lessons/journal/inbox + playbook/archive
<root>/<id>/.persona/agents/           AGENTS/CLAUDE/GEMINI（GENERATED，登场重建）
<root>/<id>/AGENTS.md                  ≤6 行指针（GENERATED）
<root>/<id>/work/                      工作产物（不同步）
<root>/<id>/.gitignore                 §3.2 清单
<root>/.index/PERSONAS.md              名册（派生、gitignore）
```

根目录解析优先级：`--root` > `PERSONA_ROOT` 环境变量 > `~/.snorkeling/personas`。
A5.5 在环境变量与默认之间插入 `settings.json: "persona:rootdir"`。

## 3. 行为契约

- **写命令默认 dry-run**：`--yes` 才落盘；显式 `--dry-run` 可强制预览
- **幂等**：已存在的 slug → 读回该人设、零写入、退出码 0、stdout 明说「nothing written」
- **dry-run 零副作用**：不 `MkdirAll`、不写名册
- **rename 是唯一合法改 id 路径**：目标已存在 → 报错不覆盖；显示名不变
- **slug 可复现**：小写 + 非 `[a-z0-9_-]` 折叠为 `-`；含非 ASCII 字符追加 8 位 sha1 后缀，避免不同中文名撞同一 slug
- **名册 L0 不含显示名**：`emoji id | role | provider/model | ./id`，每行都是注入面
- **block meta `persona:<id>` 引用重写 = A3 钩子**（当前恒 0，因为该 meta 尚未写入）

## 4. 有意收窄（与 PRD 的差异）

PRD 要求「`data` scope」。A1 只有本地人类 CLI，没有外部入口；scope 门只在
外部 agent 经 RPC/MCP 调用时才有意义。故：
- 包内导出 `persona.Scope = "data"` 作为词表锚点
- 真正的强制点在 A2.5：`agentscope.commandScopes` + `agentguide` 注册 MCP 工具时
提前往 `commandScopes` 塞不存在的 command 只会造出假门。

## 5. 验证

```bash
go test ./pkg/persona/...        # 8 个测试
go build ./cmd/wsh/
wsh persona create --name smoke --root /tmp/p --dry-run   # 0 落盘
wsh persona create --name smoke --root /tmp/p --yes       # .persona/ 12 文件
wsh persona create --name smoke --root /tmp/p --yes       # 幂等，CHARTER 不变
wsh persona rename smoke second --root /tmp/p --yes       # 旧目录消失、名册 0 引用
```

loop 包 `F-1112-persona-core-r2` 的 7 条判据由 `queue prove` 机器采数，全绿。

## 6. 未做（后继包）

- ~~A1.5：AISessions `persona` 属性、🎭 分组折叠、登场史~~（已落地，见 §7）
- A2：右键/launcher/card 三个交互创建入口 + 两步向导
- ~~A2.5：MCP 工具 + proposals 闸门 + 配额 + provenance 批准流~~（CLI 部分已落地，见 §8；MCP 工具等 `11-09-agent-block-create`）
- ~~A3：widget 🎭 + hover 弹窗 + `persona` block meta + 登场管线~~（已落地，见 §9；rename 钩子留 A4/A5）
- A4：`persona://` 名册 Block（🎭 点击回名册的入口也在此接回）
- A5 / A5.5：同步 v1 / rootdir 设置 + relocate + journal 轮转
- A6：journal 写入器 + 提议制记忆 + 蒸馏

## 7. A1.5 AISessions 集成（已落地）

任务：`.trellis/tasks/11-12-persona-aisessions/`。两个独立机制、各答各的问题：

- **归属（谁是哪个人设的）** = `summary.props.persona`（唯一显式真相，人/AI 可改；写入通道 = `wsh agent card set --prop persona=<id>`，A3 登场管线也调它）。行标 🎭、persona 筛选、登场史计数都只读它。
- **折叠（据点伪项目不混排）** = 路径命中：`projectPath` 位于 persona 根目录下且根的第一级子目录名是名册 id（分隔符 `/`/`\` 都认，比较大小写不敏感）→ 桶 key `persona:<id>`、组名 `🎭 <emoji> <name>`、不显示路径。

实现事实：

- 后端：`AISessionsListResponse` 新增可选 `personaRoot`/`personas`（`PersonaSummary` 只含 id/name/emoji/role，不带机器字段）；`IncludeProjectPaths` 时随列表下发；`loadPersonaRoster` 5s TTL 缓存，根不可读/无人设 → 空值降级不报错（失败也缓存，避免 stat 风暴）。合并视图（origins_all）下发的仍是本机名册。
- 前端：`utils.ts` 纯函数 `buildPersonaContext` / `makePersonaPathMatcher` / `personaIdOfSession` / `countSessionsOfPersona`（登场史口径 = 当前列表里 `props.persona === id` 的行数）；`groupSessionsByProject` 第 5 参 `personaCtx`；行标 chip（查不到名册显示裸 id）；persona 多选筛选纯客户端（选项 = 名册 ∪ 当前列表出现过的 `props.persona`）。
- 兼容：字段全可选，旧前端/旧后端互相降级；回滚 = revert 单 commit。

验证：`npx vitest run frontend/app/view/aisessions`（570+，含 persona 折叠/行标/登场史一致性）；`go test ./pkg/service/aisessionsservice/`（含 persona_roster_test 的填充/降级/缓存三测）。

## 8. A2.5 Agent 自创建（CLI 已落地）

任务：`.trellis/tasks/11-12-persona-agent-create/`。代码：`pkg/persona/proposal.go`、
`pkg/persona/memory.go`、`cmd/wsh/cmd/wshcmd-persona.go`（扩展）。

### propose 分流（设计 §2，对 PRD 的收窄）

按调用者身份分流，A1 人类路径零变化（F-1112 冻结判据不动）：

| 调用者（CLI 证据） | 无 `--yes` | `--yes` |
|---|---|---|
| 人类（无 `--from-session` 无 `--agent-name`） | A1 dry-run 预览（零落盘） | 直接落地，`createdBy.kind=human` |
| agent（`--from-session <key>\|this` 或 `--agent-name`） | 写 `.index/proposals/<slug>.json`，不建目录 | auto 落地，`createdBy.kind=agent` |

- `--from-session this` 走 RPC（`AgentCardGetCommand` 同款 `this` 解析，`WAVETERM_BLOCKID`）；RPC 不可用时报错并提示用字面 key
- `--charter-file` / `--memory-from-session` 只取文本做初稿（charter 覆盖生成的骨架；会话 note/tags 作为 inbox 事实草稿），不复制会话身份

### proposal 文件与批准流

`.index/proposals/<slug>.json`：`schemaVersion/kind=persona.proposal/slug/proposedAt/
proposedBy{kind,name,sessionId}/options{name,emoji,role,provider,model[,charter,memoryDraft]}/status=pending`。

- 幂等两路：persona 已存在 → 复用返回不写 proposal；同 slug proposal 已存在 → 读回返回不覆盖
- `wsh persona propose list`（`--json` 可用）；`approve <slug> --yes`（`--yes` 必须显式）→
  落地 scaffold（`createdBy` 保留 agent + 加 `approvedBy{kind:"human",ts}`）、删 proposal、重扫名册；
  `reject <slug> --yes` → 删 proposal + `.index/proposals/journal.md` 留一行（persona 尚不存在，
  留痕落在 proposals 自己的 journal，不动任何人设）

### 配额（防泛滥，设计 §5）

- 键 = `proposedBy.sessionId`；窗口 = 自然日（UTC，proposedAt）；上限 2
- 数据源 = proposal 文件本身（扫描计数，无独立状态文件）；第 3 条 → `ErrQuotaExceeded`，零写入、非 0 退出
- 无会话上下文（纯 `--agent-name`）不计数（诚实降级）

### 记忆纪律（memory add，设计 §6）

- `journal` → 直接 append 带时间戳行 + 出处（`--yes` 确认写权限），退出 0
- `facts`/`lessons` → 恒走 `MEMORY/inbox.md` 结构化提议块（来源/目标/内容），返回
  `ErrRefusedDirectWrite` → 退出码 1；`--yes` 不改行为（闸门本身）
- `createdBy.kind=human` 的人设措辞更硬（「human-authored persona」），行为同一
- journal append 后重扫名册（last-active 变化）

### dormant（90 天，设计 §7）

- last-active 代理 = max(`journal.md` mtime, `persona.json.createdAt`)；名册行超 90 天前缀 `💤`
- 只标不删；登场史（`props.persona`）并入待 A1.5 后续

### agentguide / skill 同步

`persona list/get`（observe）、`persona create/memory add/approve`（data）注册进
`pkg/agentguide`；`pkg/agentskill/.../reference/commands.md` 由 `agentguide.SkillMarkdown()`
重新生成（`TestSkillCommandsMatchGuide` 强校验）。

### 顺手修的 A1 缺陷

`plannedFiles` 曾把 400 字节的「预览」当文件正文写（`Bytes` 字段截断 + `…`），导致所有
>400 字节的 scaffold 文件（agents 契约模板、带 provenance 的 persona.json）全部损坏。
A2.5 验收时暴露（带 agent+approver provenance 的 persona.json 超 400 字节变成非法 JSON），
修复为 `Bytes` 携带完整正文（`TestCreateWritesFullFiles` 守护）。

### 验证

```bash
go test ./pkg/persona/... ./pkg/agentguide/... ./pkg/agentskill/...
d=$(mktemp -d) && wsh persona create --root $d --name p1 --from-session s1   # proposal 落盘、目录不建
wsh persona approve p1 --root $d --yes                                       # 落地 + approvedBy
wsh persona memory add p1 --section lessons --text x --root $d --yes        # 退出 1 + inbox
```

A2.5 的 7 条判据（PROPOSE/QUOTA/MEMORY_DISCIPLINE/JOURNAL/GUIDE_PERSONA 等）全绿。

## 9. A3 widget 🎭 登场（已落地）

任务：`.trellis/tasks/11-12-persona-widget-launch/`（loop 包 `F-1113-persona-widget-launch-r2`）。
登场 = `agent-launch` 现有管线 + 3 个 meta 差异，没有新进程模型。

### 代码位置

| 单元 | 文件 | 说明 |
|---|---|---|
| 前端纯逻辑 | `frontend/app/workspace/persona-launch.ts` | `PersonaWidgetId` / `AgentPersonaIdMetaKey`（block meta 键 = `persona`）/ `makePersonaHomeBase` / `personaInjectionPrompt` / `buildPersonaLaunchBlockDef` |
| 登场浮窗 | `frontend/app/workspace/persona-launch-window.tsx` | 三段式：选 Agent（provider 芯片 + 模型输入）/ 选人设 / 注入开关 |
| widget 接线 | `frontend/app/workspace/widgets.tsx` | 🎭 hover > 300ms / 点击 → 浮窗；与 Agent/Terminal/Files 浮窗互斥 |
| 模型临时覆盖 | `frontend/app/workspace/agent-launch.ts` | `createAgentBlockDefForProfile(..., modelOverride?)` —— 一次性、不回写 persona.json |
| 后端 RPC | `pkg/service/aisessionsservice/aisessionsservice.go` | `aisessions.PersonaRoster`（复用 5s TTL 名册缓存）；`derivePersonaProps` |
| 默认 widget | `pkg/wconfig/defaultconfig/widgets.json` | `defwidget@persona`（`masks-theater`；无 `blockdef` 无 `action` → 不进 Quick Launch / 组「＋」菜单，只挂右条） |

### meta 契约（登场时写入 block meta）

| 键 | 值 | 条件 |
|---|---|---|
| `persona` | `<id>` | 恒写（A4 名册 / 悬浮卡读它） |
| `cmd:cwd` | `<personaroot>/<id>` | 恒写（继承 agent-launch 的 context） |
| `persona:injectworkdir` | 本次主工作目录绝对路径 | 勾选注入时 |
| `cmd:args` 末尾一项 | `[登场上下文] 本次主工作目录: …` | 勾选注入 **且** provider ∈ {pi, codex, claude, gemini}（位置参数被当首轮 prompt）；allowlist 外跳过注入、meta 仍写 |

### props.persona 派生补带（A1.5 AC3 收口）

- 会话 `projectPath` 落在 `<root>/<id>` 下（段边界、`/`/`\` 都认、大小写不敏感、`..` 清洗）且自身无
  `props.persona` 时，`List`（`IncludeProjectPaths`）行数据就地补带
  `PropertyCell{Value: id, Source: "persona-derived"}`。
- 纯视图补带：不写 SQLite、永不覆盖显式值（`wsh agent card set --prop persona=<id>` 仍是唯一持久真相）。

### 对 PRD 的收窄（已披露）

- 点击 = 打开登场浮窗（设计原文「点击 → 名册 Block」留 A4 接回）。
- v1 无「登场中/空闲」状态点（需要会话→persona 活跃判定，归 A4 聚合）；浮窗显示 emoji + 名 + 职责。
- v1 无 cc-switch vendor 芯片、无 GUI 对话模式登场。

### 验证

- `go test ./pkg/service/aisessionsservice/ -run TestDerivePersonaProps -v`（命中 / 段边界 / 已存值不覆盖 / 分隔符与大小写）
- `npx vitest run frontend/app/workspace/persona-launch`（17 例）
- `npx vitest run frontend/app/view/aisessions`（781 例，A1.5 无回归）
- `npx tsc --noEmit` → 47 = 基线零新增
- loop 包 `F-1113-persona-widget-launch-r2` prove 8/8 全绿
- 活体验证（真 Electron 里起一次 🎭 登场，确认 cwd/meta/注入落到位）待白天补跑。
