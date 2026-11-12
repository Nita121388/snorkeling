# Persona System（人设系统）设计文档

> **Feature**: 从会话生成有固定据点、持续记忆、跨机可用、互相知晓的「人设（Persona）」——每次登场都像同一个人
> **Date**: 2026-11-12
> **Status**: ▲ 设计活跃（未实现，待用户签原型）
> **Task**: （待建 Trellis 父任务 + R0/A1–A4 子包）
> **前身**: 本功能接管 `persona` 术语；原 emoji「人格化」更名归入 AgentIcon 词族（见 §9 更名包 R0）
> **相关**: `design/plans/agent-emoji-persona.md`（emoji，待更名）、`10-29-agent-avatar-text-badge`、`11-07-commontext-sync-transport`、`11-09-agent-block-create`

---

## 1. 问题

当前 agent 会话是「散兵游勇」：每次启动都是失忆的新人，经验留在会话历史里随会话沉底。用户需要**编制内的固定角色**——管某类事、有固定据点、有记性、能跨机出差、知道有哪些同事。

## 2. 术语（本功能的词表）

| 词 | 含义 |
|---|---|
| **Persona（人设）** | 一个固定角色实体：身份 + 据点 + 记忆 |
| **登场（shift）** | 一次 persona 会话的启动（对应 agent-launch 的一个实例） |
| **据点（home base）** | persona 的固定工作目录（= 目录本身，档案在隐藏的 `.persona/` 内） |
| **档案区** | 据点内 `.persona/`：身份 + CHARTER + MEMORY，随 git 同步 |
| **工作区** | 据点内 `work/`：工作产物，不跨机 |
| **名册（PERSONAS.md）** | 全部人设的一行式索引（渐进披露 L0） |

不用的词：~~员工/Staff~~（太工作腔，已弃）、~~persona=emoji~~（让位给本功能，见 §9）。

## 3. 数据模型与目录

### 3.1 布局（档案区 / 工作区 分离）

```
<rootdir>/                          ← 设置可配（§3.5），默认 ~/.snorkeling/personas/
│
├── .index/                         # 派生数据，gitignore
│   └── PERSONAS.md                 # 名册（扫描生成，不进版本库）——渐进披露 L0，见 §7
│
└── backup-guard/                   # 据点 = 工作目录（干净的「项目根」）
    ├── .persona/                   # 档案区（隐藏，随 git 同步）——与 .git/.trellis 同一套惯例
    │   ├── persona.json            # 身份卡（id = 目录名，含 schemaVersion）
    │   ├── persona.local.json      # 本机专属（gitignore）：workdir、sync 覆盖
    │   ├── CHARTER.md              # 唯一真源：职责书（人写为主，AI 提议修订）
    │   ├── MEMORY/
    │   │   ├── facts.md            # 长期事实（头部 ## TL;DR 是注入面）
    │   │   ├── lessons.md          # 经验教训（标题分节，注入只带标题）
    │   │   ├── playbook/           # 操作手册：一类事一个文件
    │   │   ├── journal.md          # 当班流水（按月轮转 → archive/）
    │   │   ├── inbox.md            # 提议区（facts/lessons/CHARTER 只能经此入档）
    │   │   └── archive/YYYY-MM.md  # 归档是记忆的一部分 → 随 git 同步
    │   └── agents/                 # 生成物，gitignore（登场时幂等重建）
    │       ├── AGENTS.md           #   pi / codex 读
    │       ├── CLAUDE.md           #   Claude Code 读
    │       └── GEMINI.md           #   gemini 读
    │
    ├── AGENTS.md                   # 根级切口：约 16 行指针（GENERATED，真源见 .persona/）
    └── work/                       # 工作产物（gitignore；跨机不同步）
```

**为什么档案收进 `.persona/`**：据点同时是工作目录，agent 会 `ls`；CHARTER/MEMORY/persona.json 不该出现在工作面上。本仓库自己就用 `.git` / `.trellis` / `.claude` / `.gitnexus` 这套惯例。代价仅注入路径变长（根级 AGENTS.md 指路）。

**单一真源**：`CHARTER.md` + `MEMORY/` 是唯一真源；`agents/` 下所有 provider 契约文件与根级 `AGENTS.md` 均为生成物（带 GENERATED 头），登场时幂等重建，避免「两份内容手写漂移」。

**目录名 = id（写死）**：改显示名只改 `persona.json.name`；改 id 必须走 `wsh persona rename`（move + git 历史保留 + 名册/block meta 引用重写）。否则名册、`persona:id`、跨机引用全部断开。

### 3.2 .gitignore 清单（明确哪些不跨机）

```
# 本机专属
*.local.json
# 工作产物
work/
# 生成物（登场时重建）
agents/
AGENTS.md
# 派生索引
.index/
# 噪声
*.lock
.DS_Store
Thumbs.db
```

> `AGENTS.md` 与 `agents/` 二选一：本设计选「不入库 + 登场重建」保证单一真源；若希望它在仓库里可见，改为入库但保留 GENERATED 头。

### 3.3 git 粒度

默认 **rootdir 单仓**（`.gitignore` 按 §3.2），留 `persona.local.json: sync.mode = shared | own` 扩展位：超大人设可独立成仓、按需 clone。不默认每人设一仓（管理成本高于收益）。

### 3.4 容量口径

```
档案 = .persona/ 除 MEMORY/archive      ← 同步
归档 = .persona/MEMORY/archive          ← 同步
产物 = work/                            ← 不同步（只吃本机磁盘）
名册容量条三项分开计；只有「档案 + 归档」影响跨机体积
```

### 3.5 位置设置与大文件治理（需求 11）

**三层位置配置**（优先级低 → 高）：

| 层 | 配置处 | 语义 |
|---|---|---|
| L0 默认 | 内置 `~/.snorkeling/personas/` | 开箱即用 |
| L1 全局根目录 | `settings.json: "persona:rootdir"` + 设置界面 | 整个家搬到大盘 |
| L2 单人设覆盖 | `persona.local.json: workdir` | 某个人设单独放（如项目盘） |

**Settings 界面**（新增「🎭 人设」节，对接 settings 重排的 RadioCard/组卡风格）：

```
┌─ 🎭 人设 ────────────────────────────────────────────────┐
│  人设根目录                                                │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ D:/Data/personas/                      [更改…] [打开] │ │
│  │ 12 个人设 · 2.3 GB · 剩余 312 GB        ▓▓▓░░░░░ 12% │ │
│  └─────────────────────────────────────────────────────┘ │
│  ⓘ 迁移到新位置会移动全部档案并保留 git 历史 [迁移…]       │
│                                                           │
│  存储治理                                                 │
│  ☑ journal 按月轮转（journal.md → MEMORY/archive/）        │
│  ☑ 超过 30 天未登场提示休眠                                 │
│  单人设软上限 [50] MB   超出时 [仅提醒 ▾]                  │
│    （仅提醒 / 提醒+蒸馏 / 只读）                            │
│                                                           │
│  单独位置覆盖（0）                              [添加…]    │
└───────────────────────────────────────────────────────────┘
```

**迁移工具**（改配置必须配搬家车，不能只改 settings）：

```
wsh persona relocate D:/Data/personas/
    --dry-run | --yes [--exclude <id>…] [--copy-not-move]
```

- dry-run 默认：列出将移动的目录与大小
- `--yes`：逐目录 move → 更新 `persona:rootdir` → 重扫名册 → 校验（文件数/字节数前后一致）→ 失败回滚已搬部分
- git 历史随目录整体走，remote 不动；`--copy-not-move` 留双份做保险
- 只改 rootdir 不迁移 → 设置页黄条提示「X 个人设仍在旧位置」，名册不丢人设

**大文件三源治理**：

| 膨胀源 | 原因 | 治理 |
|---|---|---|
| `journal.md` | 每班 append 永不删 | 按月轮转 → `MEMORY/archive/YYYY-MM.md`，主文件归零；archive 不进注入 |
| 工作产物混进据点 | cwd = 据点 | scaffold 默认建 `work/` + gitignore；AGENTS.md 写死「产物进 work/」 |
| git 历史 | 同步需求 | 轮转后主仓恒小；archive 按月文件天然增量；超大人设走 `sync.mode=own` |

容量可视：名册详情与设置页分开展示「档案 / 归档 / 产物」三项。软上限**不硬删记忆**（记忆是资产），动作三选：仅提醒 / 提醒 + 后台蒸馏 / 只读（新写入排队进 inbox）。

**校验规则**：rootdir 必须绝对路径 + 可写；可移动盘 / 网络路径给黄色警告（跨机同步会踩坑）。

### 3.6 不变式

- **记忆纯 Markdown**（需求 6）：人可读、可 grep、可 git；SQLite 只做索引不存正文。
- 记忆**不进任何 DB**；名册/列表由扫描目录即时生成（`.index/PERSONAS.md` 是派生缓存）。
- 身份与机器解耦：档案（`persona.json` / CHARTER / MEMORY）随 git；`persona.local.json` 与 `work/` 不跨机。

## 4. 创建（需求 1/2/3）：三个入口，同一个向导

| 入口 | 位置 | 预填 |
|---|---|---|
| Agent TUI | block 头部右键 | provider/model/projectPath 固化 |
| AISessions | 会话行右键 | 同上 + note/tags/批注 → MEMORY 初稿 |
| Session Detail | 卡片 ⋯ 菜单 | 同上 |

创建向导两步：
1. **身份**：emoji picker、名字（目录名自动生成，可改）、位置（◉ 全局人设根目录 [更改…] / ○ 单独指定 [浏览…]，均为 settings 级别入口）、记忆初稿来源勾选（会话 Note/Tags/批注）。
2. **预览**：真实 scaffold 文件树（persona.json / persona.local.json / CHARTER.md / MEMORY/*）——展示的即创建的（需求 3）。

## 4.5 Agent 自创建与自维护（程序化入口 D）

> 编号 4.5：与创建入口同族，不打断后文引用。

**动机**：agent 在干活过程中自己发现「这是重复性职责」，应当能把它固化下来，不必每次都要人来建。

### 四种自创建场景

| 场景 | 命令 | 说明 |
|---|---|---|
| 升格自己 | `wsh persona create --from-session this --name …` | 把本次会话的经验固化成新人设 |
| 派生同事 | `wsh persona create --name … --charter-file …` | 发现一类重复职责，建一个专职人设 |
| 补自己记忆 | `wsh persona memory add <id> --section facts --text …` | 记事实（直接）/ 记教训（走 inbox 提议） |
| 外部 agent | MCP 工具 `persona.create` / `persona.memory.add` | 供 Claude Code / Cursor 等宿主调用 |

### 写入路径（唯一，沿用 agentdata 纪律）

```
wsh persona create [--from-session <id>|this] --name <n> [--emoji <e>]
                   [--charter-file <p>] [--memory-from-session]
                   [--dry-run | --yes] [--json]
wsh persona memory add <id> --section facts|lessons --text "…" [--dry-run|--yes]
wsh persona list|get <id> --json
```

- **dry-run 默认**，`--yes` 才落盘（与 `wsh agent card set` 同款纪律）
- **幂等**：slug 已存在 → 返回已存在（exit 0），**绝不覆盖**
- **scope 门**：`observe < navigate < data`；`create` 需要 **data scope**（复用 ACS P1.5 scoped token）
- **provenance**：`persona.json` 写 `createdBy:{kind:human|agent, name, sessionId, ts}` + `origin:{deviceId, deviceName, platform}`（照抄 CommonText 元数据模式）

### 批准闸门（默认保守）

| 模式 | 行为 | 适用 |
|---|---|---|
| **propose（默认）** | 写 `persona.proposals/<slug>.json`；名册 Block 顶部出现「⚡ 待批准（1）」；人一键批准 → 落地 scaffold | 交互式会话里的 agent |
| auto（`--yes`） | 直接落地，名册显示「⚡AI 自建」徽标 | 夜班 / loop agent、scheduled task |

### 防泛滥（必须有，否则 agent 会刷人设）

1. **幂等**：先读 PERSONAS.md（L0）比对，slug 冲突即复用而非新建
2. **配额**：单会话每日最多提议 2 个，超限写日志并拒绝
3. **休眠而非删除**：90 天未登场 → 名册折叠为 dormant
4. **人工优先**：`createdBy.kind=human` 的人设，agent 只能提议修订，**不能改 CHARTER、不能删**
5. **晋升**：AI 自建的人设一旦被人类编辑 → `createdBy.kind` 升为 `human`（人接管，agent 退为提议者）

### 记忆自维护纪律（与 loop 门链同思想）

| 区域 | 谁能直接写 | 理由 |
|---|---|---|
| `journal.md` | agent 直接 append | 流水，本来就是机器产物 |
| `facts.md` / `lessons.md` / `CHARTER.md` | 只能写 `MEMORY/inbox.md` 提议，人批准后入档 | 记忆是长期资产，机器自由写会污染——而这正是 §7 渐进披露成立的前提：**被注入的内容必须可信** |

### 与渐进披露的联动（关键）

AI 自建的人设**初始就是 L0 stub**（名字 + 一句话职责，记忆为空）→ 注入成本≈0。只有真被使用、积累事实之后才变重。没有这条，「允许自建」必然导致名册膨胀；有了这条，膨胀会被使用频率自然约束。

## 5. 右侧 widget 🎭 图标与登场（需求 7）

复用 `widget-quick-launch`（bloom-menu）+ `agent-launch.ts` 管线（block meta 记 `persona:id`）。

```
hover（>300ms）→ 选择弹窗              点击 → 人设名册 Block（§6）
```

弹窗内容（自上而下）：
1. **选 Agent（谁上身）**：provider 网格 + 模型下拉（默认取 persona.json）
2. **选人设（谁登场）**：一行一人设——emoji + 名字 + 状态点（● 登场中/○ 空闲，复用 agentstatus）+ 「＋ 新建人设…」
3. **注入开关**：`☐ 注入本次主工作目录 E:/code/snorkeling`——**可选可不选**（需求 7 原文）

**登场语义**：
- block 的 **cwd = 人设据点**（人设在自己的据点干活，读写记忆零路径切换）
- provider/model 按 persona.json，弹窗可临时覆盖
- 勾选开关 → 首条提示词前置 `[登场上下文] 本次主工作目录: <path>`（人知道去哪干活，家仍在据点）；不勾 = 纯人设任务
- 据点下自动生成 `AGENTS.md`（pi/codex 原生读）+ `CLAUDE.md`（Claude Code 原生读）：内容 = CHARTER 摘要 + MEMORY 索引 + 同事规则——**零 CLI 改造**

## 5.5 AISessions 集成（登场 = agent block，会话 = 普通会话）

**本质**：登场不是新进程模型，是 `agent-launch.ts` 现有管线 + 3 个 meta 差异：

| 差异 | 值 |
|---|---|
| `cmd:cwd` | 人设据点 |
| block meta `persona:id` | 新增，标识归属（悬浮卡/名册/aggregation 读它） |
| 首条提示注入（可选） | `[登场上下文] 本次主工作目录…` |

其余（provider/model/vendor/isolation/状态 chip/子代理/批注/AI 生成）全部免费继承。

**AISessions 可见性与两个必须处理的设计后果**：

1. persona 会话是普通 agent 会话（pi jsonl 在 `~/.pi/agent/sessions/--<编码据点路径>--/`），扫描器自动收录——无需任何接入工作。
2. 后果 A（必须处理）：pi 按会话目录名编码 cwd → **projectPath = 人设据点** → 项目分布出现 `~/.snorkeling/personas/<id>` 伪项目，与真项目混排。
   处理：项目分组里 persona 据点**折叠为「🎭 人设」分组维度**（不显示路径，显示 emoji+人设名）。
3. 后果 B（免费红利）：人设详情的「登场史」= AISessions 按 `persona` 会话属性过滤的视图——**零新账本**，名册 Block 的登场史数据源就是 AISessions 查询。
4. 会话行展示：列表行加 🎭 标 + 人设名（读 `persona` 会话属性，写入路径同 supervisor 验证过的 props 通道）。

## 6. 人设名册 Block（需求 8）

新 widget 类型 `persona://`（preview/webview 模式）。列表 + 详情双栏：

- 列表：emoji + 名字 + 状态（复用 agentstatus chip，跨面一致）+ 最近登场时间；筛选「登场中」
- 详情右栏：职责（CHARTER 头部）、据点（[打开]）、记忆统计（facts/lessons/playbook 计数 + [查看文件]）、登场史（近三日 + [全部]）、[叫TA登场] [⋯ 同步/编辑档案]

## 7. 渐进式披露（Progressive Disclosure）——防「了解成本随人数膨胀」

**问题**：人设多了之后，若登场即注入全部人设的全部记忆，token 爆炸 + 注意力稀释，且了解 10 个同事要读 10 套文档。参考 Claude Skills 的三级模型（metadata 常驻 → body 按需 → references 深层），人设系统采用**同构金字塔**：

```
            ┌─────────────────────────────┐
   L0 索引   │ PERSONAS.md：一行一人设       │  常驻注入（每次登场必带）
   ~100 tok  │ 🎭 backup-guard｜备份归档    │  成本 O(人数) 但每行极短
            │   ｜pi/deepseek｜../backup…  │  硬顶：≤50 行，超出折叠分组
            ├─────────────────────────────┤
   L1 摘要   │ 本人：CHARTER 摘要 +          │  登场时注入
   ~500 tok  │ MEMORY 目录树 + facts TL;DR │  只注入本人，同事不给
            ├─────────────────────────────┤
   L2 全文   │ lessons/playbook 具体文件     │  按需显式读
   按需      │ grep / cat / wsh persona    │  永不自动注入
            │   memory read <id> <topic>  │
            └─────────────────────────────┘
```

### 规则（写死在设计里）

1. **名册只给 L0**：一行 = emoji + 名字 + 一句话职责 + provider/model + 相对据点。想知道某同事更多 → 自己 `cat ../<id>/CHARTER.md`（L2 显式动作），**注入永远不给同事的正文**。
2. **记忆文件内部也分层**：
   - `facts.md` 头部是机器维护的 `## TL;DR`（≤5 条精选），正文按需读——注入只带 TL;DR
   - `lessons.md` 按标题分节（`## <日期> <一句话教训>`），注入只带标题列表（相当于 skill 的 description），正文 L2
3. **token 硬顶**：登场总注入 ≤ 2K tokens（L0 全名册 + L1 本人摘要）；超限先裁 L0 的折叠分组，再裁 L1 的 TL;DR 条数，**永不裁 CHARTER**。
4. **触发不注入**：用户消息命中某人设关键词时，UI 只提示「要不要叫 🎭backup-guard 登场？」，不自动展开其记忆。
5. **了解同事是显式代价**：跨人设引用一律走「读文件 + 产出里注明出处」；要改同事记忆必须写对方的 `inbox.md` 提议，对方登场时处理（提议制，与 loop 门链同思想）。

### 渐进披露 vs Skills 对照

| Skills | Persona System | 载体 |
|---|---|---|
| name+description 进 system prompt | 名册一行 + facts TL;DR | L0/L1 注入 |
| body 按需加载 | lessons/playbook 正文 | L2 显式读 |
| references 更深层 | 同事据点 | L2 + 提议制 |

## 8. 跨机同步（需求 4）与互知（需求 5）

**同步两段式**：
- **v1**：人设根目录本身即 git 仓库（`git init` + remote）；跨机 = clone/pull/push；`persona.local.json`、机器字段全部 gitignore；journal 低频追加，merge 即可。零新代码，天然版本历史与回滚。
- **v2**：接入 SyncTransport（`11-07-commontext-sync-transport` 的 folder/git/server 三实现）+ rev/origin 元数据模式，做产品化的 server 同步（配额/审计）。

**互知**：PERSONAS.md 即互知入口（§7 L0）。单独目录的人设在名册里记绝对路径。AGENTS.md 写死同事规则：可读、注明出处、改动走 inbox 提议。

## 9. 更名包 R0：emoji 让位 Persona（前置依赖，⚠️ 与 10-29 存在命名冲突）

> **2026-11-12 勘误**：R0 目前**不在任何任务中**；而 `10-29-agent-avatar-text-badge`（in_progress）的 PRD
> 写着「升级为结构化 **PersonaAvatar** 联合」，touch 白名单含两个 persona store 文件——
> 若 10-29 先行，PersonaAvatar 将再进 9 个显示面，R0 成本翻倍。
> **结论：R0 必须与 10-29 同包做（改名 + 升级一次完成），或 10-29 开工前先做 R0。建任务时写死依赖。**

现状病根：「人格化」是随口灵感，emoji 是实现本质，名字按灵感定导致概念污染。证据：
- `session-persona-store.ts` 内部函数已叫 `getSessionEmojiSnapshot` / `SessionEmojiMap`（写的人按本质命名）
- Go DTO `AgentCardResult.Persona` 恒 null 白占名
- `10-29-agent-avatar-text-badge` 已在建 `<AgentIcon>` 词族

**R0 内容**（与 10-29 合流，一个 PR）：
| 层 | 现状 | 改为 |
|---|---|---|
| L1 emoji store | `frontend/app/agent-persona/` 8 文件 | 并入 agent-icon 词族 |
| localStorage | `snorkeling:agent-personas` | `snorkeling:agent-emojis` + 读旧写新 shim |
| L2 block meta | `agent:emoji` | 不改（本就诚实） |
| Go DTO | `Persona *any` 恒 null | 不删——被本功能接管为真身 |

实测规模：176 处 / 20 文件，机械替换 + 单测 + 像素回归。

**命名纪律（防再犯，入 `.trellis/spec/guides/glossary.md`）**：
1. 术语表：一个词 = 一个概念；新 API/字段/组件/存储 key 入表必附一句「实现本质」
2. 判据：**按实现本质命名，不按灵感命名**（emoji 就是 emoji，不叫 persona）
3. review 检查项：新名与术语表冲突或表外自造 → 打回

## 10. 与现有代码对接

| 设计点 | 复用 | 缺口 |
|---|---|---|
| 右键菜单 | AISessions ContextMenuItem、block 头部菜单、info-card ⋯ | 新菜单项 |
| hover 弹窗 | widget-quick-launch + agent-launch（cwd/provider/model/meta 管线） | 人设段 |
| 登场注入 | agent-launch + block meta `persona:id`；AGENTS/CLAUDE.md 约定文件 | scaffold 生成器 |
| 状态 chip | agentstatus + agent:emoji（L2） | 人设聚合视图 |
| AISessions 收录 | 扫描器自动（零接入）；persona 会话属性 + 🎭 分组折叠 | 属性写入 + 分组改造（§5.5） |
| 名册 Block | preview/webview widget 模式 | 新 view `persona://` |
| 同步 | git（v1）/ SyncTransport（v2） | — |
| 登场流水 | supervisor（2026-11-12 会话验证的原型）正式化 | journal 写入器 |
| 程序化创建 | `agentscope`（observe<navigate<data）、`agentmcp` MCP 门面、`agentguide` 能力表 | persona 命令组 + MCP 工具 |
| provenance | CommonText `createdBy`/`origin` 元数据模式（`11-07`） | 照抄结构 |
| 提议闸门 | loop 门链「人批准才入档」+ `reflect-skill` 提议制 | proposals 目录 + 名册待批准区 |

## 11. 拆包路线

| 包 | 内容 | 依赖 |
|---|---|---|
| R0 | emoji→AgentIcon 更名（**与 10-29 同包**，改名+PersonaAvatar 升级一次完成）+ 术语表 | — |
| A1 | persona 数据模型 + scaffold（`.persona/` 布局 + `work/` + 生成物）+ `wsh persona create/list/get/rename`（rename = move + 引用重写，id 变更的唯一合法路径） | R0 |
| A1.5 | AISessions 集成：persona 会话属性 + 🎭 分组折叠 + 登场史查询（§5.5） | A1 |
| A2 | 三个交互创建入口 + 两步向导 | A1 |
| A2.5 | **Agent 自创建**：CLI + MCP 工具 + proposals 闸门 + 配额 + provenance | A1 |
| A3 | widget 🎭 图标 + hover 弹窗 + 登场注入 | A1 |
| A4 | 名册 Block `persona://` + agentstatus 聚合 | A1 |
| A5 | 同步 v1（rootdir 单仓 + .gitignore 清单 + `sync.mode=own` 扩展位） | A1 |
| A5.5 | **位置与治理**：`persona:rootdir` 设置节 + `wsh persona relocate` + journal 按月轮转 + 容量三项口径（§3.5） | A1 |
| A6 | journal 写入器（supervisor 正式化）+ 提议制记忆 + 蒸馏 | A3 |

> 注：`wsh persona rename` 已并入 **A1**（不单列包）——它与 create/list/get 共用同一套 store 与幂等语意，拆开会产生一次无谓的跨包依赖。

## 12. 开放问题

1. 名册 L0 超过 50 人设时的折叠分组维度（按 provider？按项目？）——先不解决，等真实规模
2. persona.json 里 provider/model 是否允许 per-登场覆盖后回写——建议不回写（登场是临时覆盖）
3. PERSONAS.md 的机器维护时机：创建/删除时即时重生成 vs 定时扫描——建议即时
4. AI 自建人设的 slug 是否允许带前缀（如 `ai-backup-guard`）以便一眼识别来历——建议不加前缀，靠名册徽标 + createdBy 字段区分
5. 外部 agent 通过 MCP 创建时，是否需要二次确认（宿主 UI 弹窗）——建议：propose 模式下不需要（默认不落地），auto 模式需要
6. 根级 `AGENTS.md` 是否入库（可见档案）vs gitignore + 登场重建——本设计取后者（单一真源）；若实测发现「clone 后首登前 agent 读不到」体验差，再改入库
7. journal 轮转周期固定按月 vs 按体积阈值（如 2MB）——建议按月为主 + 体积兜底（任一满足即轮转）
