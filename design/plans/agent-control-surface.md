# Agent Control Surface（ACS）— 让本地 Agent 驱动 Snorkeling UI

> 状态：▲ 设计活跃（未实现）
> 镜像源：`pkg/agentcontrol/`（规划中）、`cmd/wsh/cmd/`（扩展）
> 关联：`docs/project/agent-data-patch.md`、`docs/project/agent-config.md`、`docs/project/ai-sessions.md`、`design/plans/agent-dashboard.md`
> 日期：2026-11-01
> 版本：v1 草案（待评审）

---

## 1. 需求拆解

用户要求：让本地 Agent（pi / codex / claude-code / opencode 等）能够

| # | 能力 | 用户原话 |
|---|---|---|
| C1 | 读取当前打开的 Block（结构 + 内容 + 运行时状态） | 「读取 snorkeling 当前打开的 Block」 |
| C2 | 在指定 Tab 中打开对应类型的 Block | 「在 Tab 中打开对应类型的 Block」 |
| C3 | 打开 Agent（GUI 对话块 / TUI 终端块） | 「agent」 |
| C4 | 读取会话状态 | 「读取会话状态」 |
| C5 | 编写 agent card | 「编写 agent card」 |
| C6 | 读取并操作 Common Text | 「读取操作 Common Text」 |

这六项组合起来本质上是同一件事：**一个受控、可发现、可审计的「Agent → Snorkeling UI」控制面**。
本文把它命名为 **Agent Control Surface（ACS）**。

### 1.1 成功判据

一个本地 Agent 在 Snorkeling 的 Block 内，只用 shell 就能完成如下闭环，且无需用户手工点 UI：

**第一优先（实时会话 + 会话卡）：**

```bash
wsh session live --json | jq '.sessions[] | {provider, state: .issue.state, title}'
wsh session get this --json | jq '{title, note, tags, hash: .card.hash}'
wsh agent card set this --note "已整理" --tags-add 已整理 --dry-run
wsh agent card set this --note "已整理" --tags-add 已整理 --yes
```

**第二优先（UI 观察 + 导航）：**

```bash
wsh ui active --json | jq '.active'
wsh block open --view preview --file /repo/README.md --tab new --wait
wsh block read 2 --tail 80 --json
```

并且在失败时得到稳定错误码、可重试语义、以及「是否已同步到 UI」的明确信号。

---

## 2. 非目标（v1 明确不做）

1. **不新增网络监听面**：不开放新的 TCP/HTTP 端口给 Agent。
2. **不引入远程调用**：ACS 只服务本机、本进程内的 Snorkeling。
3. **不替代 Wave AI 的 function calling**（`pkg/aiusechat`）：那是「应用内 AI 调工具」，ACS 是「外部 Agent 调应用」。两者共享底层 `wcore`，但协议独立。
4. **不绕过 `wsh data` 的写安全模型**：所有用户数据写入仍走 patch（备份 + 审计 + 前置条件）。
5. **P0 不含外部 Agent 接入**（App 外进程没有 `WAVETERM_JWT`）。外部接入按 §10.5 的四层设计在 **P1 / P1.5 / P1.6** 落地：scoped token → CLI/MCP → skill。
6. **不实现任意 meta 写入**：`setmeta` 已有，但 ACS 的 `block open` 只接受白名单 meta 字段。

---

## 3. 现状盘点

### 3.1 已经存在的积木（不要重复造）

| 层 | 位置 | 现状 | 对 ACS 的价值 |
|---|---|---|---|
| CLI 传输 | `cmd/wsh/cmd/wshcmd-root.go` | `wsh` 通过 **unix domain socket / Windows TCP** 连主进程；用 Block 环境里的 `WAVETERM_JWT` 认证；`WAVETERM_BLOCKID` / `WAVETERM_TABID` 提供当前上下文 | 现成的、每 Block 隔离的 Agent 入口；零配置 |
| wsh RPC 面 | `pkg/wshrpc/wshrpctypes.go` + `pkg/wshrpc/wshserver` | 已有 `BlocksListCommand` / `CreateBlockCommand`（**已支持 `TargetBlockId` + `TargetAction` = replace/splitup/splitdown/splitleft/splitright、`Magnified`、`Ephemeral`、`Focused`，并 `SendUpdateEvents`**）/ `DeleteBlockCommand` / `GetTabCommand` / `GetMeta` / `SetMeta` / `SetBlockFocus`(tab 路由) / `AgentStatus` / `AgentProfileList` | 扩展点明确；`CreateBlockCommand` 的实现可直接复用，**不要**再写第二条创建路径；改接口后 `task generate` 自动生成 TS 绑定 |
| 前端 UI 真相面 | `frontend/app/store/tabrpcclient.ts` | 已注册 `getfocusedblockdata` / `setblockfocus` / `captureblockscreenshot` / `waveaiaddcontext`，按 `tab:<tabId>` 路由 | **焦点/活动 Tab/布局几何/minimized 只能从这里读**，设计直接复用该模式 |
| 业务服务层 | `pkg/service/service.go`（`ServiceMap`） | `object` / `workspace` / `block` / `commontext` / `aisessions` / `window` 的反射式 RPC，同时暴露给 FE 与本地 HTTP `/wave/service` | 语义参考；**但 `/wave/service` 用的是 authkey，不适合给 Agent**，ACS 不复用它做传输 |
| 核心写路径 | `pkg/wcore/block.go` / `wcore/layout.go` / `wcore/workspace.go` | `CreateBlockInTab`、`MoveBlockToTab`、`CopyBlockToTab`、`CreateTab`、`SetActiveTab` 已存在；后端写 DB + `QueueLayoutAction` 让 FE 异步应用 | ACS 的写操作应**直接调 wcore**，与 service 层同源，避免两套逻辑 |
| 数据写安全 | `pkg/agentdata/patch.go` + `cmd/wsh/cmd/wshcmd-data.go` + `pkg/agentcap/agentcap.go` | 版本化 patch、`--dry-run`、`--yes`、SQLite 备份、表级回滚、`patch-audit.jsonl`、`wsh data guide/schema/examples/prompt` | **C5/C6 的写入必须挂在这里**，只需加 operation 类型 |
| 会话索引 | `pkg/aisessions/*`（`Manager`、`SessionSummary`、`liveregistry.go`、`metastore.go`） | 会话扫描、note/tags/props/title、live 注册表、父子/子代理折叠 | C4 的数据源 |
| Common Text | `pkg/commontextstore/*` + `pkg/service/commontextservice` | List/Get/Tags/Update/RenameTag；已迁到 SQLite | C6 的数据源 |
| Agent 状态 | `pkg/agentstatus/*` + `wsh agentstatus` + hookinstall | Block ↔ provider/sessionId/state（working/idle/blocked/release）、`Get(blockId)`、`agentstatus:osnotify` | C3/C4 的运行时信号；**已证明 Agent 进程里可以调 `wsh`** |
| Agent 启动 | `frontend/app/workspace/agent-launch.ts` + `agent.tsx`（viewType=`agent`）+ `widgets.tsx` | GUI 对话块 meta：`{view:"agent","aisessions:newchat":true}`；TUI 用 profile 组装 cmd/model/cc-switch vendor env | **启动逻辑在 FE**，ACS 必须经 tab 路由复用，不能在后端重写 |

### 3.2 缺口（本文要补的）

| 缺口 | 影响 |
|---|---|
| 没有「UI 快照」概念：`wsh blocks list` 只给 DB 里的 block+meta，不含活动 Tab、焦点 Block、布局几何、magnified/minimized、block 编号（`1`、`ai:2` 这种短引用） | C1 不可用 |
| `createblock`（hidden）硬编码 `WAVETERM_TABID`，**没有把 RPC 已有的 `--split` / `--replace` / `--magnified` / `--focus` 暴露到 CLI**；也没有 `tab` 命令组 | C2 不可用（能力在 RPC 已存在，缺的是 CLI 门面） |
| Agent 启动（GUI/TUI）无 CLI 入口 | C3 不可用 |
| 会话只能 `wsh data export` 全量导出，没有 `list/get/live/for-block` | C4 不可用 |
| `agent card` 可写字段只有 note/tags（`session_note.update`）；`title` 有独立 RPC + `titleSource` 语义；**persona 头像只存在于前端 localStorage** | C5 只完成一半，且头像无后端真相 |
| Common Text 只有 List/Get/Tags/Update/RenameTag；缺 create/delete/pin；缺「用到某处」（注入 composer / 剪贴板） | C6 读不全、写不了、用不了 |
| 没有能力开关、限流、控制面审计；`wsh deleteblock` 无确认 | 安全边界缺失 |
| `agentcap` 只讲数据 patch，没有 UI 控制面指南 | Agent 不可发现 |

---

## 4. 设计原则

1. **一个传输面：`wsh`。** 不新增端口、不复用浏览器 authkey。认证沿用 Block 级 JWT，天然做到「哪个 Block 的 Agent 只有那个 Block 的入口凭据」。
2. **读走 query，写走 patch。** 所有读操作是纯查询命令；所有用户数据写入（card / common text）转成 v1 patch 经 `agentdata` 执行，自动获得备份、审计、前置条件与 dry-run。
3. **两个真相源显式标注。** 后端 SQLite（稳定、可离线）与前端的 layout/焦点（实时）合并时，输出 `sources` 字段；不假装后端一定是最新。
4. **Agent 优先的输出契约。** 所有新命令默认支持 `--json`，输出稳定 schema、稳定错误码、`truncated` 标记、有界大小。
5. **短引用可用。** 复用现有 `ResolveIdsCommand` 语义（`this` / `2` / `tab:1` / `ai:2` / `uuid8`），并在快照里给出 `num`，让 Agent 能低成本反复寻址。
6. **失败要可恢复。** `--wait` 超时不等于失败（`synced:false`），错误码区分「参数错 / 找不到 / 无权限 / 冲突 / 超时」。
7. **不破坏现有命令。** `blocks list`、`createblock`、`focusblock`、`data apply` 的输出与行为保持向后兼容；新命令是新增而非替换。
8. **能力可关。** 默认「观察 + 导航」开，「破坏性」关；通过 settings 显式打开。

---

## 5. 总体架构

```
┌───────────────────────────────────────────────────────────────────────┐
│ 本地 Agent 进程（pi / codex / claude / opencode / gemini）              │
│   环境：WAVETERM_JWT, WAVETERM_BLOCKID, WAVETERM_TABID, WSHBINDIR      │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ shell: wsh ... --json
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│ wsh CLI（cmd/wsh/cmd）                                                 │
│  参数校验 → 能力检查（读 settings）→ RPC → JSON/表格输出 → 退出码      │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ JWT auth (domain socket / TCP)
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│ root router (pkg/wshutil)                                              │
└───────┬─────────────────────────────────────────────┬─────────────────┘
        │ 默认路由（主进程）                          │ tab:<tabId> 路由
        ▼                                             ▼
┌──────────────────────────────┐        ┌──────────────────────────────────┐
│ wshserver                    │        │ Renderer TabClient               │
│  + pkg/agentcontrol (新)     │        │  frontend/app/store/tabrpcclient │
│    ├ state.go  快照构建       │        │   ├ uistatelive（焦点/几何/折叠）│
│    ├ open.go   block 开/移/拷 │        │   ├ agentlaunch（复用启动逻辑）  │
│    ├ session.go 会话读        │        │   ├ inserttext（注入 composer）  │
│    ├ card.go   card 读/写     │        │   └ setagentpersona（头像）      │
│    ├ commontext.go 常见文本   │        └────────────┬─────────────────────┘
│    ├ limits.go 限流/能力      │                     │ jotai atoms / layoutModel
│    └ audit.go  控制面审计     │                     ▼
└───────┬──────────────┬───────┘        ┌──────────────────────────────────┐
        │              │                │ 前端实时状态（layout / WOS）      │
        ▼              ▼                └──────────────────────────────────┘
┌──────────────┐  ┌─────────────────────┐
│ wcore/wstore │  │ agentdata（patch）   │
│  写 DB +     │  │ 备份 / dry-run /    │
│  LayoutAction│  │ 审计 / 前置条件      │
└──────────────┘  └─────────────────────┘
```

**关键判断：** `wshserver` 与 `wstore` 同进程，因此 ACS 的读操作直接调 `wstore`/`aisessions`/`commontextstore`，不走反射 service 层，也不走 `/wave/service`。写操作调 `wcore` 并让 `QueueLayoutAction` 通知前端——与现有 service 层完全同源。

---

## 6. 命令面设计

命名遵循现有风格。**命名约定（避免歧义）：**

- `wsh blocks ...` = **查询**面，沿用现状（`blocks list`）。
- `wsh block ...` = **动作**面，新增（`open/read/move/copy/close`）；`block list` 作为 `blocks list` 的别名，两条都可用。
- `wsh agent` 已存在（`agent list`），新增 `agent card` / `agent guide` 作为子命令，不新建 `agents`。
- `wsh tab` / `wsh session` / `wsh commontext` / `wsh ui` 均为新增组，与现有 root 命令无冲突。

### 6.1 观察：`wsh ui`

```bash
wsh ui active [--json]                  # 极短查询：活动 window/workspace/tab/block + blockNum
wsh ui state  [--json] [--live] [--content]
              [--window <id>] [--workspace <id>] [--tab <id>]
              [--max-bytes 65536]       # --content 时的内容上限
wsh ui find   [--view <v>] [--agent <provider>] [--conn <conn>] [--cwd <path>]
              [--title <substr>] [--json]
wsh ui focus  [--block <id|this>] [--tab <id>] [--wait]
```

- `ui state` 默认只读后端；`--live` 额外并发请求每个 tab 路由的 `uistatelive`，合并焦点/几何/minimized/magnified。并发上限 8，失败不致命（进 `sources.failedTabs`）。
- `--content` 对每个 block 附加有界内容：`term` 取 scrollback 尾部，`preview/edit` 取 `meta.file` 内容（远程走 `fileshare`），`web` 取 url，`agent` 取会话摘要。
- `ui active` 是 `ui state` 的裁剪结果，专门给 Prompt / 循环体里频繁调用（返回 < 2 KB）。

### 6.2 打开 / 移动：`wsh block`

```bash
wsh block open  --view <term|web|preview|edit|agent|vdom|tsunami>
                [--tab active|new|<tabid>] [--workspace <id>]
                [--split right|down|left|up | --replace <blockid>]
                [--magnified] [--no-focus]
                [--url <u>] [--file <path>] [--cwd <dir>] [--conn <conn>]
                [--agent-profile <name>] [--agent-session <id>]
                [--wait[=<ms>]] [--dedupe] [--json]

wsh block move  <block|this> --to-tab active|new|<tabid> [--activate] [--wait] [--json]
wsh block copy  <block|this> --to-tab active|new|<tabid> [--activate] [--wait] [--json]
wsh block read  <block|this> [--tail <n>] [--lastcommand] [--max-bytes <n>] [--json]
wsh block close <block|this> [--dry-run] [--yes]
```

- `block open` 是 `createblock`（hidden）的超集，保留旧命令做别名。
- `--view agent` → 创建 GUI 对话块（`{view:"agent","aisessions:newchat":true}` + 目标上下文），走**后端** `wcore.CreateBlockInTab`。
- `--agent-profile`（TUI）→ 走 **tab 路由** `agentlaunch`，因为 profile→cmd/model/cc-switch vendor env/autoresume 的组装逻辑在 `frontend/app/workspace/agent-launch.ts`，后端复制一份必然漂移。
  **结论：`block open` 内部按参数分散到两条路径，对调用者保持同一个命令与同一个返回结构。**
- `--dedupe`：在目标 tab 内查找「同 view + 同签名 meta（url / file / agent session）」的既有 block，命中则返回它并置 `deduped:true`，用于防止 Agent 循环里重复开块。
- `block read` 按 view 分派（详见 §7.2），全部有界并带 `truncated`。

### 6.3 Tab：`wsh tab`

```bash
wsh tab list     [--workspace <id>] [--json]
wsh tab create   [--workspace <id>] [--name <s>] [--activate] [--layout empty|term] [--wait] [--json]
wsh tab activate <tabid> [--wait] [--json]
wsh tab close    <tabid> [--dry-run] [--yes]
```

`--wait` 语义：轮询 `Workspace.ActiveTabId == tabid`（后端真相），默认 1500ms；FE 未运行时只在后端生效。

### 6.4 会话：`wsh session`

```bash
wsh session list [--source pi|codex|claude|opencode|gemini|all]
                 [--query <q>] [--tag <t>] [--project <path>] [--marked]
                 [--limit 20] [--json]
wsh session get  <sessionKey|sessionId|this> [--detail] [--max-bytes <n>] [--json]
wsh session live [--json] [--include-idle]     # 实时运行会话总览（§7.6）
wsh session for-block [<blockid|this>] [--json]
wsh session wait <sessionKey|this> --until idle|blocked|finished [--timeout 60s] [--json]   # P2
```

- `list` 直接调 `aisessions.Manager`（与 `wsh data export --domain sessions` 同源），但支持筛选与分页，避免全量导出。
- `get` 支持 `this`：`block.agent:sessionid` → `agentstatus.Get(blockId).SessionId` → `liveregistry` → 会话文件。
- `--detail` 返回 `SessionDetail`（消息时间线），默认只返回 `SessionSummary`。
- **`live` 是本项目的核心命令**：合并三处真相（agentstatus / chatManager / liveregistry），输出 `LiveSessionRecord[]`，见 §7.6。默认只返回「非 idle」的行，`--include-idle` 返回全部存活行。

### 6.5 Agent card：`wsh agent card`

```bash
wsh agent card get <sessionKey|sessionId|this> [--json]
wsh agent card set <sessionKey|sessionId|this>
                   [--title <t>] [--note <s>|--note @file]
                   [--tags-set a,b] [--tags-add a,b] [--tags-remove a,b]
                   [--prop k=v]... [--avatar <emoji|provider>]
                   [--force] [--dry-run] [--yes] [--json]
```

- `get` 返回：`summary`（title/titleSource/note/tags/props）+ `persona`（P1 前为 `null`）+ `hash`。
- **写入是 patch 的 sugar，不是新的写路径**：
  - `--note` / `--tags-*` → **复用现有 `session_note.update`**（真实 apply 需 `expectedHash`，自动备份 + 审计）。
  - `--title` → 新 op `session_title.update`；写 `titleSource="ai"`，`titleSource=="user"` 且无 `--force` → `E_CONFLICT`。
  - `--prop` → 新 op `session_prop.update`；内置键拒绝，`source=user` 默认跳过（`--force` 才覆盖），返回值回报 `skipped[]`。
  - `--avatar` → **P1**：v1 通过 tab 路由写前端 persona 存储；v2 迁移到后端（见 §15 D3）。
- 一次调用里 `note/tags/title/prop` 混用 = 生成**一个** patch，内含多条 operation；任一前置条件失败则整体不写（`agentdata` 的失败回滚语义）。

### 6.6 Common Text：`wsh commontext`

```bash
wsh commontext list [--query <q>] [--tag <t>] [--pinned] [--limit 50] [--json]
wsh commontext get  <id> [--json]
wsh commontext tags [--json]
wsh commontext use  <id> --into composer|clipboard|term [--block <id|this>] [--submit] [--json]
wsh commontext create --title <t> --text <s>|--text @file [--tags a,b] [--shortcut <k>] [--pinned]
                      [--dry-run] [--yes]
wsh commontext update <id> [--title] [--text] [--tags-set|--tags-add|--tags-remove] [--pinned|--unpinned]
                      [--dry-run] [--yes]
wsh commontext delete <id> [--dry-run] [--yes] [--permanent]
wsh commontext pin    <id> [--off]
```

- 写操作 = patch 的 sugar：`common_text.create` / `common_text.delete` / `common_text.pin`，仍走备份 + 审计 + `expectedHash`。
- `use --into composer` → tab 路由 `inserttext`（或 P0 阶段先复用 `waveaiaddcontext` + `submit:false`）。
- `use --into term` → 走现有 `ControllerInputCommand` / `wsh term`，把文本送进目标终端 block（带 `--submit` 时追加回车）。
- `use --into clipboard` → `wsh` 侧通过 `wsh util`/electron 剪贴板 RPC（已有 `wsh setvar` 等模式；实现时确认 `ElectronSetClipboard` 是否已存在，否则加一个）。

### 6.7 命令矩阵（能力 × 风险）

| 命令组 | 只读 | 写用户数据 | 改 UI 结构 | 破坏性 | 默认能力档 |
|---|---|---|---|---|---|
| `ui state/active/find` | ✅ | | | | observe |
| `ui focus` | | | ✅ | | navigate |
| `block open/move/copy` | | | ✅ | | navigate |
| `block read` | ✅ | | | | observe（`--content` 需 `readcontent`） |
| `block close` | | | ✅ | ✅ | destructive（默认关） |
| `tab list/create/activate` | 部分 | | ✅ | | navigate |
| `tab close` | | | ✅ | ✅ | destructive（默认关） |
| `session *` | ✅ | | | | observe |
| `agent card get` | ✅ | | | | observe |
| `agent card set` | | ✅ | | | data（需 `--yes`） |
| `commontext list/get/tags` | ✅ | | | | observe |
| `commontext use` | | | ✅ | | navigate |
| `commontext create/update` | | ✅ | | | data（需 `--yes`） |
| `commontext delete` | | ✅ | | ✅ | destructive（需 `--yes`） |

---

## 7. 数据契约

### 7.1 `UIStateSnapshot` v1

```json
{
  "version": 1,
  "generatedAt": 1761980000123,
  "sources": {
    "backend": "ok",
    "live": "partial",
    "liveTabs": ["tabIdA", "tabIdB"],
    "failedTabs": [{ "tabId": "tabIdC", "error": "no route" }]
  },
  "client": { "clientId": "…", "windowIds": ["win1"] },
  "active": {
    "windowId": "win1",
    "workspaceId": "ws1",
    "tabId": "tabIdA",
    "blockId": "blk7",
    "blockNum": 3
  },
  "windows": [
    {
      "windowId": "win1",
      "workspaceId": "ws1",
      "workspaceName": "snorkeling",
      "focused": true,
      "tabs": [
        {
          "tabId": "tabIdA",
          "num": 1,
          "name": "main",
          "active": true,
          "layout": {
            "focusedNodeId": "node3",
            "magnifiedNodeId": null,
            "leafOrder": ["blk1", "blk7", "blk9"]
          },
          "blocks": ["blk1", "blk7", "blk9"]
        }
      ]
    }
  ],
  "blocks": {
    "blk7": {
      "blockId": "blk7",
      "num": 3,
      "tabId": "tabIdA",
      "workspaceId": "ws1",
      "windowId": "win1",
      "view": "term",
      "controller": "shell",
      "title": "codex",
      "conn": "local",
      "meta": { "cmd:cwd": "/repo", "frame:title": "codex" },
      "runtime": {
        "status": "running",
        "exitCode": null,
        "cwd": "/repo",
        "lastCommand": "npm test",
        "shellIntegration": "ready",
        "agentProvider": "codex",
        "agentSessionId": "019a…",
        "agentStatus": "working"
      },
      "layout": { "focused": true, "magnified": false, "minimized": false,
                  "rect": { "x": 0, "y": 0, "w": 960, "h": 720 } },
      "content": null
    }
  },
  "agents": {
    "blk7": {
      "provider": "codex", "sessionId": "019a…", "state": "working",
      "phase": "tool", "tool": "shell", "message": "running tests",
      "reason": "", "seq": 12, "updatedAt": 1761980000000
    }
  }
}
```

**约束：**
- `meta` 必须经过 **allowlist + 脱敏**（§10.3）。默认只放 UI 相关键：`view/controller/connection/cmd:cwd/frame:title/icon/url/file/agent:provider/agent:sessionid`。
- `blocks` 是扁平索引（按 id 查），`windows[].tabs[]` 只放 id 引用，避免同一份数据重复膨胀。
- `num` 来自 LayoutState.LeafOrder（与 `resolveSimpleId("2")` 语义一致）；`--live` 时用 FE 的 leafOrder 覆盖。
- 大小上限：默认 256 KB；超限时裁剪 `content` 并置 `truncated:true`。

### 7.2 `BlockReadResult` v1

统一外壳：

```json
{
  "version": 1,
  "blockId": "blk7",
  "view": "term",
  "kind": "term",
  "truncated": false,
  "bytes": 4211,
  "payload": { },
  "warnings": []
}
```

按 view 的 `payload`：

| view | payload 字段 |
|---|---|
| `term` | `lines: string[]`, `lineCount`, `lastCommand`, `shellIntegration`, `agentStatus` |
| `preview` / `edit` | `file: string`, `content: string`, `language?: string`, `isDir?: boolean` |
| `web` | `url: string`, `title?: string`（title 需 `--live`，从 tab 路由取） |
| `agent` | `sessionKey`, `summary: SessionSummary`（不含正文） |
| `vdom` / `tsunami` | `appMeta` 摘要（`ShortDesc` 等），不返回 HTML |
| 未知 | `error: "unsupported view"` + 仍然返回 meta/runtime |

### 7.3 `BlockOpenRequest` / `BlockOpenResult`

```json
// request（内部 RPC，不是用户直接看的）
{
  "view": "preview",
  "tab": { "mode": "active" },
  "workspaceId": "",
  "target": { "mode": "split", "blockId": "", "direction": "right" },
  "magnified": false,
  "focus": true,
  "waitMs": 0,
  "dedupe": false,
  "meta": { "file": "/repo/README.md" }
}
```

```json
// result
{
  "version": 1,
  "ok": true,
  "tabId": "tabIdA",
  "blockId": "blk9",
  "blockNum": 4,
  "view": "preview",
  "deduped": false,
  "syncState": "db-only",       // db-only | layout-applied | active-tab-applied
  "waitedMs": 0,
  "warnings": []
}
```

`syncState` 是给 Agent 的关键信号：`db-only` 表示 block 行已创建、但 FE 还没渲染（通常 1 帧内会完成）。`--wait` 会把状态推进到 `layout-applied`。

### 7.4 `AgentCard`

```json
{
  "version": 1,
  "sessionKey": "codex:abc:/path/session.jsonl",
  "sessionId": "019a…",
  "title": "整理 ACS 设计",
  "titleSource": "ai",
  "note": "已整理",
  "tags": ["设计", "已整理"],
  "props": { "优先级": { "type": "select", "value": "P1", "source": "ai" } },
  "persona": { "kind": "emoji", "value": "🧭", "scope": "session" },
  "hash": "sha256:…",
  "updatedAt": 1761980000000
}
```

### 7.5 Common Text 记录

复用 `wconfig.CommonTextItemType`（`id/title/text/tags/shortcut/pinned/createdAt/updatedAt/lastUsedAt/usageCount`）+ `hash`（agentdata 导出格式）。

### 7.6 `LiveSessionRecord` v1（实时运行会话）

```json
{
  "version": 1,
  "generatedAt": 1761980000123,
  "sources": { "agentStatus": "ok", "chat": "ok", "index": "ok" },
  "sessions": [
    {
      "blockId": "blk7",
      "tabId": "tabIdA",
      "windowId": "win1",
      "view": "term",
      "conn": "local",
      "provider": "codex",
      "sessionId": "019a…",
      "sessionKey": "codex:019a…:/path/session.jsonl",
      "title": "整理 ACS 设计",
      "titleSource": "ai",
      "projectPath": "/repo",
      "issue": {
        "state": "working",
        "phase": "tool",
        "tool": "shell",
        "message": "running tests",
        "reason": "",
        "source": "hook",
        "confidence": "high",
        "prevState": "idle",
        "activeSince": 1761979900000,
        "updatedAt": 1761980000000,
        "expiresAt": 1761980060000,
        "freshness": "fresh",
        "seq": 12
      },
      "chat": {
        "live": true,
        "state": "running",
        "isStreaming": true,
        "modelProvider": "openai",
        "modelId": "gpt-5-codex",
        "thinkingLevel": "high",
        "contextUsagePct": 0.42,
        "messageCount": 12,
        "lastUsedAt": 1761980000000
      },
      "card": {
        "note": "已整理",
        "tags": ["设计", "已整理"],
        "props": { "优先级": { "type": "select", "value": "P1", "source": "user" } },
        "hash": "sha256:…"
      },
      "warnings": []
    }
  ]
}
```

**字段语义（实现契约，不能含糊）：**

| 字段 | 来源 | 说明 |
|---|---|---|
| `issue` | `agentstatus.Get(blockId)` | TUI Agent 的实时状态。`freshness`：`expiresAt==0` → `fresh`；`now < expiresAt` → `fresh`；否则 `stale`；无记录 → 字段整体为 `null` |
| `chat` | `chat.Manager` + `Session.GetState()` | 仅 GUI chat（当前只有 `pi` 注册为 provider）。`null` 表示不是 GUI 会话。`state` ∈ `starting/idle/running/closed` |
| `sessionKey`/`title`/`note`/`tags`/`props` | `aisessions.Manager.Summary` | 解析 `agent:sessionid`；远程连接解析失败时置 `null` 并进 `warnings`（不阻塞整行） |
| `card.hash` | 会话摘要 hash | 供 `agent card set` 的 `expectedHash` 使用，免二次查询 |
| `state` 映射 | `agentstatus.State*` | `working→working`、`idle→idle`、`blocked→blocked`、`rate-limited/error→blocked`（`reason` 区分）、`stale→stale`、`release` 不出现 |

**「哪些算实时运行」的判定（三条任一）：**

1. 存在 `agentstatus` 记录（状态非 `release`）。
2. `chat.Manager` 里有该 `source/sessionId` 的存活 `Session`。
3. 块 `meta` 含 `agent:sessionid` **且** `blockcontroller` 状态为 `running`（用于「刚启动、hook 还没报到」的空窗）。

默认输出过滤掉 `state==idle && !isStreaming` 的行；`--include-idle` 全量。

**边界：**

- **远程连接块**：`agentstatus` 可用（wsh 回流），但 `sessionKey` 需远端 manager；v1 置 `card=null` + `warnings:["remote-summary-unavailable"]`，不报错。
- **未落盘的新 GUI 会话**：`liveregistry` 已有条目 → `Live=true`，`sessionKey` 来自 provisional summary。
- **过期状态**：`expiresAt < now` 仍返回，但 `freshness=stale`，由调用方决定是否采信（不要静默丢弃，Agent 需要知道「它曾经 working，现在不确定」）。

---

## 8. RPC 设计

### 8.1 新增 wsh RPC（`pkg/wshrpc/wshrpctypes.go`）

> 改完必须跑 `task generate`（会重新生成 `frontend/app/store/wshclientapi.ts`、`pkg/wshrpc/wshclient`、`frontend/types/gotypes.d.ts`）。

```go
// 观察
UIStateCommand(ctx context.Context, data UIStateRequest) (*agentcontrol.UIStateSnapshot, error)
UIStateLiveCommand(ctx context.Context, data UIStateLiveRequest) (*agentcontrol.UIStateLive, error) // 内部按 tab 路由扇出，不暴露给 CLI

// 结构变更
// BlockOpenCommand = 编排层（tab 别名解析 → meta 白名单 → 调既有 CreateBlockCommand → dedupe → wait → 结果富化）。
// 内部不重新实现创建/布局逻辑。
BlockOpenCommand(ctx context.Context, data agentcontrol.BlockOpenRequest) (*agentcontrol.BlockOpenResult, error)
BlockMoveCommand(ctx context.Context, data agentcontrol.BlockTransferRequest) (*agentcontrol.BlockTransferResult, error)
BlockCopyCommand(ctx context.Context, data agentcontrol.BlockTransferRequest) (*agentcontrol.BlockTransferResult, error)
TabListCommand(ctx context.Context, data agentcontrol.TabListRequest) (*agentcontrol.TabListResult, error)
TabCreateCommand(ctx context.Context, data agentcontrol.TabCreateRequest) (*agentcontrol.TabCreateResult, error)
TabActivateCommand(ctx context.Context, data agentcontrol.TabActivateRequest) (*agentcontrol.TabActivateResult, error)

// 会话
SessionListCommand(ctx context.Context, data agentcontrol.SessionListRequest) (*agentcontrol.SessionListResult, error)
SessionGetCommand(ctx context.Context, data agentcontrol.SessionGetRequest) (*agentcontrol.SessionGetResult, error)
SessionLiveCommand(ctx context.Context, data agentcontrol.SessionLiveRequest) (*agentcontrol.SessionLiveResult, error)

// 数据（读）
CommonTextListCommand(ctx context.Context, data agentcontrol.CommonTextListRequest) (*agentcontrol.CommonTextListResult, error)
CommonTextGetCommand(ctx context.Context, data agentcontrol.CommonTextGetRequest) (*agentcontrol.CommonTextGetResult, error)
CommonTextTagsCommand(ctx context.Context, data agentcontrol.CommonTextTagsRequest) (*agentcontrol.CommonTextTagsResult, error)

// 数据（写，全部转 patch）
AgentCardWriteCommand(ctx context.Context, data agentcontrol.AgentCardWriteRequest) (*agentdata.Report, error)
CommonTextWriteCommand(ctx context.Context, data agentcontrol.CommonTextWriteRequest) (*agentdata.Report, error)
```

设计取舍：
- **`BlockOpenCommand` 是编排层，不是第二套创建实现。** 它内部：① 解析 `--tab active|new|<id>`（`new` 先调 `TabCreateCommand`）；② 校验 meta 白名单；③ 调既有 `wshserver.CreateBlockCommand`（已含 split/replace/magnified 与 `SendUpdateEvents`）；④ `--dedupe` 查重；⑤ `--wait` 轮询；⑥ 富化 `blockNum` / `syncState`。这样 FE 收到的事件与 `wsh createblock` 完全一致。
- `BlockMove` / `BlockCopy` 同理：直接调 `wcore.MoveBlockToTab` / `CopyBlockToTab`（与 `ObjectService` 共用），不复制参数处理。
- **不新增** `BlockCloseCommand` / `TabCloseCommand`：复用既有 `DeleteBlockCommand` 与 `WorkspaceService.CloseTab` 的 wcore 路径，CLI 侧加确认；避免第二条删除路径。
- `AgentCardWriteCommand` / `CommonTextWriteCommand` 返回 `agentdata.Report`，让 CLI 原样打印可读报告（与 `wsh data apply` 一致），避免两套输出格式。

### 8.2 新增 tab 路由命令（`frontend/app/store/tabrpcclient.ts`）

| 命令 | 入参 | 返回 | 用途 |
|---|---|---|---|
| `uistatelive` | `{ tabId }` | `{ tabId, active, focusedNodeId, focusedBlockId, magnifiedNodeId, minimizedBlockIds, leafOrder, rects }` | `ui state --live` 合并实时真相 |
| `agentlaunch` | `{ profile, model, mode: "gui"\|"tui", cwd, conn, tabId, focus }` | `{ blockId }` | 复用 `agent-launch.ts` 的组装逻辑 |
| `inserttext` | `{ blockId, text, submit, mode: "composer" }` | `{ ok }` | Common Text / 引用注入 |
| `setagentpersona` | `{ sessionId, emoji }` | `{ ok }` | v1 头像写入（localStorage） |

**注意：** `uistatelive` 必须是**纯读、无副作用**，且不能阻塞渲染线程。布局几何从 `layoutModel.getNodeAdditionalProperties` 读，和现有 `captureblockscreenshot` 同源。

### 8.3 与 service 层的关系（避免双写）

```
service 层（ObjectService.CreateBlockInTab） ─┐
                                              ├─► wcore.CreateBlockInTab ─► DB + QueueLayoutAction
ACS（agentcontrol.open）                     ─┘
```

规则（写进 spec）：
- ACS **不得**在 `wshserver` 里复制 `objectservice` 的参数处理逻辑；只做「参数解析 + 能力检查 + 调 wcore + 组装结果」。
- 任何「DB 写 + 事件发」组合必须留在 `wcore`，ACS 不许自己发 `wps` 事件（防止事件顺序漂移）。
- 新增字段优先加在 `wcore` 函数签名上，让 service 与 ACS 同时受益。

---

## 9. 关键流程时序

### 9.1 `block open --tab new --wait`

```
Agent            wsh CLI                 wshserver/agentcontrol        wcore            FE(tab route)
  │                │                            │                         │                  │
  ├─block open────►│                            │                         │                  │
  │                ├─TabCreateCommand──────────►│                         │                  │
  │                │                            ├─wcore.CreateTab────────►│                  │
  │                │                            │◄── tabId ───────────────┤                  │
  │                │                            ├─wcore.CreateBlockInTab─►│                  │
  │                │                            │                         ├─DB insert        │
  │                │                            │                         ├─QueueLayoutAction│
  │                │                            │◄── block ───────────────┤                  │
  │                │◄── {tabId, blockId} ───────┤                         │                  │
  │                │                            │                         │ (wps event) ────►│ insert node
  │                ├─(wait) poll tab route──────┼─────────────────────────┼─────────────────►│ layouthasblock
  │                │◄── {synced:true} ──────────┤                         │                  │
  │◄── json ───────┤                            │                         │                  │
```

要点：
- 时序图上半段的创建/布局分支复用 `wshserver.CreateBlockCommand` 的 switch（replace/split），ACS 只做「选 tab + 参数校验 + 结果富化」。
- `blockId` 在 wcore 返回时就已可用（DB 行已提交），**不要**等 FE 才返回，否则 Agent 会超时。
- `--wait` 只影响 `syncState` 字段，不影响退出码（超时 → `synced:false` + 退出码 0，附 `warnings`）。
- 失败回滚由 `wcore.CreateBlockInTab` 内部完成（已有），ACS 不做二次清理。

### 9.2 `ui state --live`

```
wsh ──► backend 快照（windows/workspaces/tabs/blocks/layoutstate/runtime/agentstatus）
     ──► 并发（≤8）请求每个 tab 的 uistatelive
     ──► merge：FE 值覆盖 backend（focused/magnified/minimized/rect/leafOrder）
     ──► 脱敏 + 截断 + 输出 sources
```

合并优先级（从高到低）：`tab route` > `LayoutState`（DB 持久化）> `Tab.BlockIds`（顺序）。
`LayoutState.FocusedNodeId` 是 FE 写回的，可能落后 1 个 debounce 周期，所以 `--live` 时以 tab route 为准并标注 `liveTabs`。

### 9.3 `agent card set`

```
1. resolve session（key/id/this）→ wsh session get → hash + titleSource
2. 校验：title 冲突？tags 合法？props 类型？
3. 构造 patch: { version:1, operations:[{type:"session_card.update", sessionKey, expectedHash, ...}] }
4. --dry-run → agentdata.Apply{DryRun:true} → 打印字段级 before/after
5. --yes   → agentdata.Apply{Yes:true} → 备份 + 写 + 审计
6. 输出 Report（与 wsh data apply 同构）
```

### 9.4 `commontext use --into composer`

```
wsh ──► CommonTextGetCommand（取 text）
    ──► 解析目标：--block 或当前 block 的 tab 路由
    ──► tab 路由 inserttext { blockId, text, submit }
    ──► FE: WaveAIModel / AgentViewModel 的 composer append
```

失败降级：
- 目标 tab 无路由（FE 未开）→ `E_NO_ROUTE`，提示改用 `--into clipboard`。
- 目标 block 不是 composer 视图 → `E_UNSUPPORTED_TARGET`。

---

## 10. 安全、权限与审计

### 10.1 威胁模型

| 威胁 | 说明 | 缓解 |
|---|---|---|
| 恶意/失控 Agent 刷爆 UI | 循环开块、反复切 tab | 限流（§10.4）+ `--dedupe` |
| 泄密 | 快照/内容把 token/API key 带出去 | allowlist + 正则脱敏 + `--raw` 需显式开关 |
| 越权 | 任意进程伪造 wsh 调用 | JWT 只注入 Block 环境；socket 权限 0700 |
| 数据覆盖 | Agent 覆盖用户手写 note/title | `expectedHash` 前置条件、`titleSource` 保护、`--force` |
| 破坏性操作 | 删 block/tab/commontext | 默认关闭 + `--yes` + 审计 + 可恢复（备份/trash） |

### 10.2 能力开关（新增 settings）

```jsonc
// schema/settings.json + pkg/wconfig/settingsconfig.go + metaconsts.go
{
  "agent:control:*": true,                    // 批量重置
  "agent:control:enabled": true,              // 总开关
  "agent:control:allow": ["observe", "navigate", "data"],  // 能力档；不含 destructive
  "agent:control:readcontent": true,          // block read / ui state --content
  "agent:control:readrawmeta": false,         // --raw meta（默认脱敏）
  "agent:control:allowdelete": false,         // destructive 档
  "agent:control:maxopenperminute": 20,       // 每来源 Block 的 open 限流
  "agent:control:maxstatereadperminute": 120, // 快照限流
  "agent:control:audit": true
}
```

默认值原则：**观察全开、导航开、数据写开（但必须 `--yes`）、破坏性全关。**

### 10.3 脱敏规则（硬性）

1. `meta` 只输出 allowlist 键（见 §7.1）。
2. 任何键名匹配 `(?i)(token|secret|password|passwd|apikey|api_key|privatekey|credential)` 的值一律替换为 `"***"`。
3. `cmd:env` 永不输出（只输出 `cmd:env` 的**键名列表**，且仅在 `readrawmeta` 开启时）。
4. `web` block 的 url 去查询串中的 `token|key|sig` 参数。
5. `session` 摘要不返回 `FilePath`，除非 `--detail` 且 `readrawmeta` 开启（路径可能含用户名）。
6. `--raw` 需要 `agent:control:readrawmeta=true`，并在审计里记录。

### 10.4 限流

- 实现：`pkg/agentcontrol/limits.go`，滑动窗口计数，key = `来源 BlockId + 命令族`。
- 超限返回 `E_RATE_LIMIT`，payload 带 `retryAfterMs`。
- 计数仅在内存（重启清零）；不做跨进程持久化，避免误伤。

### 10.5 外部 Agent 接入（App 外）

#### 10.5.1 问题本质：缺的是凭据，不是说明书

App 外 Agent 缺两样东西：

1. **传输凭据**：`WAVETERM_JWT`（Block 级、内嵌 socket 名、当前实现无 `exp`）。
2. **上下文**：`WAVETERM_BLOCKID` / `WAVETERM_TABID`（决定 `this` 语义、审计来源）。

所以「给一个 skill」**不能**解决接入问题——skill 是提示词与配方，不带凭据。
同理「给一个插件」也只是把凭据与工具注册做得更顺手。
**正确顺序：先做授权（token）→ 再做协议门面（CLI / MCP）→ 再做能力说明（skill）→ 最后才是宿主插件。**

#### 10.5.2 四层结构（不是四选一）

| 层 | 解决什么 | 不解决什么 | 必需性 |
|---|---|---|---|
| L1 授权 | 外部进程如何被信任、如何限权、如何撤销 | 工具怎么用 | **必须**（没有它，后三层都不成立） |
| L2 协议门面 | 工具如何被调用（CLI / MCP） | 模型如何用得对 | **必须**（至少一种） |
| L3 能力说明（skill） | 何时用、怎么组合、危险操作怎么停 | 认证、传输 | **强烈建议** |
| L4 宿主插件 | 安装、配置、连接状态、宿主 UI 集成 | 能力本身 | 按分发需求 |

依赖关系：

```
L1 token ──► L2a wsh CLI ──► L2b wsh mcp serve ──► L3 skill
                   │                  │                 │
                   └──────────────────┴─────────────────┴──► L4 插件（只做包装）
```

#### 10.5.3 L1：scoped agent token（授权）

**做法：**给 `wavejwt.WaveJwtClaims` 增加外部接入所需的 claim，签一个**短时、可撤销、带 scope**的 token。

```go
// pkg/wavejwt/wavejwt.go —— 新增字段（都是 omitempty，向后兼容）
type WaveJwtClaims struct {
    jwt.RegisteredClaims              // 复用 ExpiresAt / IssuedAt / ID(jti) / Audience / Subject
    Sock      string `json:"sock"`
    RouteId   string `json:"routeid"`
    BlockId   string `json:"blockid,omitempty"`
    // 新增：
    AgentName string   `json:"agentname,omitempty"` // 审计 / 显示名
    Scope     []string `json:"scope,omitempty"`     // observe | navigate | data | destructive
    WindowId  string   `json:"windowid,omitempty"`  // 限定窗口（可选）
}
```

- `jwt.ParseWithClaims` 已自动校验 `exp`，**零成本拿到过期语义**。
- `RouteId` 用 `agent:<name>:<uuid8>`（例如 `agent:codex-external:3f9a1c2d`），与 Block 路由区分，便于审计与排障。`RpcContext.GenerateRouteId()` 已优先返回显式 `RouteId`，无需改 router 逻辑。
- **scope 校验放在 `pkg/agentcontrol`**（不在 router 层）：router 保持通用，ACS 每个命令入口检查「本次调用所属 link 的 claims」。
- **claims 如何到达 handler（实现要点）**：`claimsToRpcCtx` 目前只搬运 `Sock/RouteId/BlockId/Conn/Router`。最小改动是把 `Scope` / `AgentName` / `ExpiresAt` / `jti` 也放进 `wshrpc.RpcContext`，由 `AuthenticateCommand` 成功后把 claims 存进 router 的 `linkMeta`，并提供 `wshutil.GetAuthClaimsForRoute(sourceRouteId)` 供 `agentcontrol` 查询。**不要**让 handler 重新解析 token（会重复验证、易出分歧）。
- 撤销：`jti` 黑名单（内存 + 可选持久化到 `<configdir>/agent-control/revoked.json`），`wsh auth revoke --all` 立即生效（对已认证的 live link 也要主动 `untrustLink`）。
- 限流 key 从 `来源 BlockId` 改为 `token jti`。

**生成入口（两选一，先做 A）：**

```bash
# A. 在 App 内的任意 Block 里执行（用户主动、显式、可审计）
wsh auth grant --name codex-external \
                --scope observe,navigate,data \
                --ttl 30m \
                --out ~/.config/snorkeling/agent-token.json

wsh auth list            # 当前有效 token（name / scopes / exp / jti 前缀）
wsh auth revoke --all    # 或 --name codex-external
```

```text
# B. Electron 菜单（P2）：Settings → Agent Access… → 勾选 scope / TTL / 保存路径
#    背后调用同一个 auth grant 实现，不复制逻辑。
```

**Token 文件格式（0600）：**

```json
{
  "version": 1,
  "name": "codex-external",
  "token": "eyJhbGciOiJFZERTQSIs...",
  "socket": "/Users/nita/Library/Application Support/snorkeling/wave.sock",
  "scopes": ["observe", "navigate", "data"],
  "expiresAt": 1761981800000,
  "createdAt": 1761980000000
}
```

同时把 `socket` 写进文件只是**方便排查**；实际连接仍以 JWT 内嵌的 `sock` claim 为准（两者由同一处生成，天然一致）。

**`wsh` 侧的 token 来源链（优先级从高到低）：**

1. `--token-file <path>`（推荐：不进 shell history）
2. `SNORKELING_AGENT_TOKEN_FILE` 环境变量
3. `SNORKELING_AGENT_TOKEN`（直接给 token 字符串，不推荐）
4. `WAVETERM_JWT`（App 内旧路径，保持不变）
5. `~/.config/snorkeling/agent-token.json`（默认约定路径，最后兜底）

`preRunSetupRpcClient` 改为按上述链取 token；`setupRpcClient` 里 `WAVETERM_BLOCKID` 为空时不再强制设置 peerInfo。

**外部 token 下的 `this` 语义：**

- `this` 解析为「当前活动窗口的活动 Tab 的焦点 Block」，通过 `UIStateCommand` 求得。
- 解析结果必须显式回显：`{"resolvedFrom":"active","blockId":"…","tabId":"…"}`，并在 stderr 打一行提示。
- `--block <id>` / `2` / `tab:1` 等短引用保持现有语义（但 `2` 需要当前 tab 上下文 → 外部 token 下禁用，报 `E_USAGE`，要求用完整 id 或 `ui active` 拿到 id）。
  理由：外部进程没有「当前 tab」，猜测上下文会制造难以复现的行为。

#### 10.5.4 L2a：CLI 门面（`wsh --token-file`）

- 优点：所有 Agent 都有 shell，零额外依赖；与 App 内使用完全同一条代码路径。
- 缺点：工具调用是字符串拼装，模型容易错参数；无法表达「只读/破坏性」注解。
- 必需改动：`cmd/wsh/cmd/wshcmd-root.go` 的 token 来源链；`pkg/agentcontrol` 的 scope 检查；审计 `source.name`。

#### 10.5.5 L2b：MCP 门面（推荐，与 CLI 并存）

```bash
wsh mcp serve --stdio [--token-file <path>]
```

**为什么用 `wsh mcp serve` 而不是新发一个 `snorkeling-mcp` 二进制：**

1. `wsh` 已经随 App 同版本分发（`WAVETERM_WSHBINDIR`），零安装。
2. 复用同一个 token、同一个 `pkg/agentcontrol` 实现，**不可能出现两套行为**。
3. 少一个需要签名/公证/发布的产物。

**工具集（v1，12 个，覆盖 §6 的 6 组能力）：**

| tool | 参数 | scope | annotations |
|---|---|---|---|
| `snorkeling_ui_state` | `{live?, includeContent?, tabId?}` | observe | `readOnlyHint: true` |
| `snorkeling_ui_active` | `{}` | observe | `readOnlyHint: true` |
| `snorkeling_ui_focus` | `{blockId, tabId?}` | navigate | `idempotentHint: true` |
| `snorkeling_block_open` | `{view, tab, split?, replace?, magnified?, focus?, url?, file?, cwd?, conn?, agentProfile?, wait?}` | navigate | `destructiveHint: true`（可能覆盖 target） |
| `snorkeling_block_read` | `{blockId, tail?, maxBytes?}` | observe | `readOnlyHint: true` |
| `snorkeling_block_move` | `{blockId, toTab, activate?}` | navigate | `destructiveHint: false` |
| `snorkeling_tab_list` | `{}` | observe | `readOnlyHint: true` |
| `snorkeling_tab_create` | `{workspaceId?, name?, activate?}` | navigate | |
| `snorkeling_session_list` | `{source?, query?, tag?, limit?}` | observe | `readOnlyHint: true` |
| `snorkeling_session_get` | `{sessionKey, detail?, maxBytes?}` | observe | `readOnlyHint: true` |
| `snorkeling_agent_card_set` | `{sessionKey, title?, note?, tags?, props?, avatar?, dryRun?, confirm?}` | data | `destructiveHint: true` |
| `snorkeling_commontext` | `{op: list\|get\|use\|create\|update\|delete, ...}` | observe/navigate/data | 按 op 动态标注 |

**MCP 特有的两个增值点（CLI 做不好）：**

1. **resources**：`snorkeling://state`（快照）、`snorkeling://sessions/{key}`（只读摘要）。支持 resources 的宿主可以让用户「@ 当前界面」而不是让模型反复轮询。
2. **annotations**：`readOnlyHint` / `destructiveHint` 让宿主（Claude Code / Cursor）自己弹审批，而不是依赖我们自己实现的 `--yes`。

**传输：**v1 只做 **stdio**。不开放 TCP listener——那会立刻把 §10.1 的威胁模型放大一个量级。

**token 传递：**优先 `--token-file`；若宿主支持环境变量，用 `SNORKELING_AGENT_TOKEN_FILE`。**不要**把 token 放进 MCP server 的 args（会出现在宿主的 `ps` 输出与配置里）。

#### 10.5.6 L3：Skill（能力说明，必做但不是核心）

产物：`skills/snorkeling-control/`

```text
skills/snorkeling-control/
  SKILL.md                 # 何时用、用哪个、红线
  reference/commands.md    # 命令速查（与 wsh agent guide 同源生成，避免漂移）
  reference/recipes.md     # 常见配方：读当前界面 / 开会话 / 整理 note / 用 Common Text
  scripts/ensure-token.sh  # 检查 token 是否存在，不存在则提示用户运行 wsh auth grant
```

**SKILL.md 必须写死的红线：**

1. 不得在 skill 文本、脚本、仓库里写入 token。
2. 危险操作（`block open --replace`、`close`、`commontext delete`）先 `--dry-run`，再向用户确认，最后才 `--yes`。
3. 不得用轮询代替事件：优先 `wsh ui active`（< 2 KB），不要每秒 `ui state --live`。
4. token 缺失时**停止并请求用户授权**，不要尝试绕过（例如读 `WAVETERM_AUTH_KEY`）。
5. 假设「界面可能已变化」：写入前用 `expectedHash`，读取前先 `ui active`。

**为什么 skill 不能替代 MCP：**

- skill 是给模型看的说明，无法约束参数形状；MCP 有 JSON Schema，模型错参率显著更低。
- skill 无法参与宿主的权限审批 UI；MCP 的 `annotations` 可以。
- 但 skill 能覆盖 MCP 覆盖不了的 Agent（纯 shell agent、老版本 IDE 插件），所以两者是互补。

**分发：**仓库内 `skills/` + 一个 `scripts/install-skills.sh`，支持 Claude Code / Codex / pi 的 skills 目录约定；不绑定某一家。

#### 10.5.7 L4：宿主插件（P2，按需）

插件只做三件事，不做能力：

1. 往宿主写 MCP server 配置（`wsh mcp serve --stdio`）。
2. 引导生成 / 选择 token 文件（调用 `wsh auth grant`，不自己签）。
3. 显示连接状态与 scope（读 `wsh auth list`）。

可选宿主：pi extension、VS Code / Cursor extension、JetBrains plugin。
**结论：v1/v1.5 不做插件。** MCP + skill 已经覆盖 90% 场景，而每个宿主插件都是独立维护成本。

#### 10.5.8 明确不做

| 不做 | 原因 |
|---|---|
| 云中继 / 跨机器接入 | 需要公网信任链与端到端加密，完全另一个安全等级 |
| 无 token 的本地 HTTP 万能入口 | `/wave/service` 用的是 authkey + 反射式全量服务，暴露给外部等于交出整个应用 |
| 把 `WAVETERM_AUTH_KEY` 给外部进程 | 它是全局共享密钥，无法限权、无法撤销、无法审计 |
| 「自动发现并静默授权」 | 违背显式授权原则；外部 Agent 首次必须由用户主动 grant |
| 长寿命 token（> 24h） | 泄露后窗口太大；上限 24h，默认 30m |

#### 10.5.9 安全细则（外部 token 专属）

1. token 文件权限 `0600`，目录 `0700`；写之前先 `os.OpenFile(..., 0600)`，不要先创建再 chmod。
2. `--token-file` 优先于 `--token`；后者仅在交互式调试时允许，并在 `wsh auth` 帮助里标注不推荐。
3. scope 最小化：`auth grant` 默认只给 `observe`；`navigate` / `data` 需显式列出；`destructive` 永不默认。
4. 每个 token 独立 `jti`，支持单独 revoke；`revoke --all` 写黑名单并清空默认路径文件。
5. 审计里记录 `agentname` + `jti` 前缀（不记录完整 token）。
6. 限流按 `jti` 计（§10.4），避免一个失控 Agent 影响 App 内其它 Agent。
7. 外部 token 默认**不能** `--content`（`agent:control:readcontent` 之外再加 `external:readcontent` 开关），因为外部进程可能把内容写到别处。
8. 外部 token 默认**不能** `block close` / `tab close` / `commontext delete`（即使 scope 里有 destructive，也要求 `agent:control:allowdelete`）。

#### 10.5.10 落地优先级

| 阶段 | 交付 |
|---|---|
| P1 | `wavejwt` claims + `wsh auth grant/list/revoke` + `wsh --token-file` + scope 强制 + 审计/限流接入 |
| P1.5 | `wsh mcp serve --stdio`（12 tools + 2 resources）+ 单测（JSON Schema 快照） |
| P1.6 | `skills/snorkeling-control/` + 安装脚本 + `wsh agent guide` 与 skill 同源校验 |
| P2 | Electron「Agent Access」面板、宿主插件、resources 订阅推送 |

**验收标准（端到端）：**

```text
① 在 App 内跑 wsh auth grant --name ext-test --scope observe --ttl 5m --out /tmp/t.json
② 在 iTerm（App 外）跑 wsh --token-file /tmp/t.json ui active --json   → 成功
③ 同一条命令跑 wsh block open ...                                      → E_FORBIDDEN（scope 不含 navigate）
④ wsh auth revoke --all 后再跑 ②                                        → 认证失败
⑤ 把 token 改成过期时间 → 失败，错误码 E_UNAUTHORIZED
```

### 10.6 控制面审计

```
<userdata>/agent-data/audit/control-audit.jsonl
```

每行：

```json
{"ts":1761980000123,"source":{"blockId":"blk7","tabId":"tabIdA"},"cmd":"block open","risk":"navigate","argsHash":"sha256:…","ok":true,"result":{"blockId":"blk9"},"durationMs":12}
```

只记录 `navigate` / `data` / `destructive`；`observe` 不进审计（否则日志爆炸），但保留 `--trace` 选项。

---

## 11. 一致性、幂等与错误语义

### 11.1 同步语义

| 操作 | 后端同步 | FE 异步 | `--wait` 观测点 |
|---|---|---|---|
| `tab create/activate` | ✅ ActiveTabId | 是 | 轮询 `Workspace.ActiveTabId`（后端即可判定） |
| `block open` | ✅ Block 行 + Tab.BlockIds | 是（layout insert） | tab 路由 `uistatelive` 含该 blockId |
| `block move/copy` | ✅ 两个 Tab.BlockIds | 是 | 同上 |
| `ui focus` | ❌ 纯 FE | 是 | tab 路由 `focusedBlockId` |
| `agent card set` | ✅ | 否（走 wps 刷新） | 无需等待 |

### 11.2 错误码

| code | 退出码 | 场景 |
|---|---|---|
| `E_USAGE` | 2 | 参数非法 / 组合冲突（如 `--split` + `--replace`） |
| `E_NOT_FOUND` | 3 | block/tab/session/commontext 不存在 |
| `E_CONFLICT` | 4 | `expectedHash` 不匹配、title 受保护、dedupe 冲突 |
| `E_FORBIDDEN` | 5 | 能力档未开 / 限流 / 脱敏策略拒绝 |
| `E_UNSUPPORTED` | 6 | view 不支持该操作、目标不是 composer |
| `E_NO_ROUTE` | 7 | 目标 tab 的 FE 路由不在线 |
| `E_TIMEOUT` | 8 | `--wait` 超时（**注意**：JSON 仍返回 `ok:true` + `synced:false`；退出码用 8 让脚本可判定） |

`--json` 时错误也输出到 stdout（结构化），stderr 只放人类可读摘要。

### 11.3 幂等

- `block open --dedupe`：同 tab、同 view、同签名 meta → 复用。
- `tab create --dedupe`（可选）：同 workspace 同 name 的空 tab 复用。v1 不做，避免语义模糊。
- 写操作天然幂等（patch + 前置条件），重复 apply 会因 hash 不匹配而 `E_CONFLICT`，这正是期望行为。

---

## 12. Agent 可发现性

沿用 `pkg/agentcap` 的「按需加载」模式，**不**往每个 Agent 的 system prompt 里注入。

新增：

```bash
wsh agent guide                 # 人类可读的一页式控制面指南
wsh agent guide --json          # 机器可读：命令 + 参数 + 返回 schema + 错误码
wsh agent capabilities          # 当前进程实际开启的能力档（读 settings 后求值）
```

`pkg/agentcap/agentcap.go` 增加：

```go
const ControlGuideCommand = "wsh agent guide"
func ControlGuideText() string
func ControlCapabilitiesJSON() string   // 反映当前 settings 求值结果
```

同时把 `wsh data prompt` 的紧凑 prompt 扩一段：

```
UI Control (Snorkeling):
- wsh ui active --json            → 当前窗口/工作区/tab/焦点 block
- wsh ui state --json --live      → 全量快照（含布局与运行时）
- wsh block open --view <v> --tab new --wait --json
- wsh block read <block> --tail 80 --json
- wsh session list --limit 10 --json ; wsh session get <key> --json
- wsh agent card set <key> --note ... --dry-run   (then --yes)
- wsh commontext list --json ; wsh commontext use <id> --into composer
```

**MCP 门面（P1.5，推荐）：** `wsh mcp serve --stdio` 把同一批 RPC 暴露成 MCP tools + resources（详见 §10.5.5）。
先做 CLI 再做 MCP 的理由：CLI 是 MCP 的底层（同一个 token、同一个 `pkg/agentcontrol`），先固化命令契约与错误码、再包装成 schema 的成本最低；反过来做会返工。MCP 只是**同一后端的第二种门面**，不会引入第二套逻辑。

**Skill 与 MCP 的分工：** skill 负责「用得对」（配方、红线、何时停），MCP 负责「调得动」（schema、只读注解、审批钩子）。两者不可互相替代，详见 §10.5.6。

---

## 13. 分阶段实施

### 13.0 优先级（2026-11-01 已与用户确认）

| 序 | 批次 | 能力 | 为什么这个顺序 |
|---|---|---|---|
| 1 | **P0.0** | 实时运行的会话（读） | 用户首要需求；纯后端读，零 FE handler，零数据风险 |
| 2 | **P0.1** | 会话 agent card（写） | 用户第二需求；`note/tags` 可零新增 op 复用现有 patch |
| 3 | P0.2 | UI 观察与导航（`ui` / `block open` / `tab`） | 有价值但不阻塞前两项；`block open` 依赖 P0.0 的块发现 |
| 4 | P0.3 | `ui state --live`、`session list` 筛选、`agent guide` | 完善观察面 |
| 5 | P1 | Common Text、agent 启动、破坏性操作 | 用户明确降级 |
| 6 | P1.5 | 外部 token / MCP / skill | 先把内部 CLI 契约跑顺 |
| 7 | P2 | persona 后端化、插件、布局模板 | 按需 |

> 本文档 §6 的命令面是**目标态**，不等于实施顺序；以本节为准。

---

### P0.0 — 实时运行的会话（MVP-1，2–3 人日）

目标：Agent 一条命令掌握「此刻有哪些会话在跑、谁在跑、跑到哪一步、属于哪个会话卡」。
**纯读，零数据写入，不新增前端 handler。**

| # | 交付 | 复用的现成能力 | 本轮新增 |
|---|---|---|---|
| 1 | `LiveSessionRecord` 模型 + 合并器 | `agentstatus.Get`、`chat.Manager`、`aisessions.Manager.Summary`、`blockcontroller` 状态、block meta | `pkg/agentcontrol/{types,session,redact}.go` |
| 2 | `chat.Manager.ActiveSessions()` | `Manager.sessions`（新增一个只读快照方法） | `pkg/aisessions/chat/manager.go` |
| 3 | `SessionLiveCommand` / `SessionGetCommand` / `SessionListCommand` | 上述三处真相 | `wshrpctypes.go` + `wshserver`（3 个薄 RPC，均只读） |
| 4 | `wsh session live / get / list` | 上述 RPC | `cmd/wsh/cmd/wshcmd-session.go` |
| 5 | block → session 解析（`this`） | `agent:sessionid`、`agent:provider`、`agentstatus.SessionId`、`liveregistry` | `agentcontrol/session.go` |
| 6 | 降级策略（远程块 / 未落盘 / 过期） | `expiresAt`、`liveregistry` | 行内 `warnings` + `freshness` |

**关键实现点：**

- `chat.Manager` 目前只有 `Get` / `ActiveCount`，**没有枚举接口**。新增 `ActiveSessions()` 返回
  `[]LiveChatInfo{Source, SessionID, State, LastUsed, Provisional bool}`；`Provisional` 标记 `new:<uuid>` 这类还没拿到真实 sessionId 的临时 key。
- `GetState()` 是 RPC 往返：并发上限 4、单次 1.5s 超时；超时只丢 `chat.model/thinking/contextUsage`，**不丢整行**。
- `aisessions.Manager.Summary` 对每个 live session 调一次太重：先用 `ListCached` 或 sqlite 索引批量拿摘要，缺的再逐个 `Summary`。
- 远程连接块：`agentstatus` 可用（wsh 回流），但摘要解析在远端 → `card:null` + `warnings:["remote-summary-unavailable"]`，不报错。
- 输出按 `agentstatus.Seq` / `updatedAt` 去重，避免同一 block 多个 source 重复出行。

**Day-1 验收剧本：**

```bash
wsh session live --json | jq '.sessions[] | {provider, state: .issue.state, phase: .issue.phase, title}'
wsh session live --json | jq '.sessions | length'          # 与 UI 上正在跑的 agent 数一致
wsh session get this --json                                # 在 agent block 内调用，拿到自己的行
wsh session get <sessionKey> --json | jq '.card.hash'      # 拿到可写入的 hash
```

**完成判据：** 在「1 个 codex TUI + 1 个 pi GUI chat + 1 个空闲 agent block」三种现场下，
`session live` 的行数、状态、phase、title 均与 UI 一致；kill 一个 agent 后 ≤ TTL 内状态变为 `stale/idle`。

---

### P0.1 — 会话 agent card 读写（MVP-2，2–3 人日）

目标：Agent 能读、能改「这个会话的卡片信息」，且不会覆盖用户手写内容。

| # | 交付 | 复用的现成能力 | 本轮新增 |
|---|---|---|---|
| 1 | `wsh agent card get` | `Manager.Summary`（title/titleSource/note/tags/props）+ `hash` | CLI 组装，无新后端 |
| 2 | `wsh agent card set --note/--tags-*` | **现有 `session_note.update` patch op**（含 `expectedHash`、备份、审计） | **零新增 op**，只做 sugar |
| 3 | `wsh agent card set --title` | `Manager.SetTitle` 会标 `source=user`，需要 AI 变体 | 新 op `session_title.update` + `Manager.SetAITitle(force)` |
| 4 | `wsh agent card set --prop k=v` | `ApplyAIProperties` 的安全契约（拒内置键、跳过 `source=user`、类型白名单） | 新 op `session_prop.update` + `Manager.SetAIProps(force)` |
| 5 | `--dry-run` / `--yes` / `--force` | `agentdata.Apply` 现有能力 | 透传 |

**语义（必须与现有行为一致，不能自创）：**

- `note/tags`：真实 apply 必须带 `expectedHash`；`tags.set: []` = 清空；`tags.add`/`remove` 增量。**直接复用 agentdata**。
- `title`：若现有 `titleSource == "user"` 且未传 `--force` → `E_CONFLICT`（保护用户手写标题）；AI 写入标 `titleSource="ai"`。
- `prop`：内置键（`note`/`tags`/`starred`/`title_source`）一律拒绝；`source=user` 的既有值默认跳过并回报 `skipped[]`。
- 头像/persona：**本批不做**（仅存前端 localStorage，见 §15 D3）。

**Day-1 验收剧本：**

```bash
wsh agent card get this --json
wsh agent card set this --note "整理完成" --tags-add 已整理 --dry-run     # 打印字段级 diff
wsh agent card set this --note "整理完成" --tags-add 已整理 --yes         # 备份 + 写入 + 审计
wsh agent card set this --title "ACS 设计" --dry-run                     # user 标题 → E_CONFLICT
wsh agent card set this --prop 优先级=P1 --dry-run                       # 跳过 user 值并说明
```

**完成判据：** 写入后 UI 会话卡即时刷新（wps 事件）；并发手改后旧 hash 被 `E_CONFLICT` 拦住；
`control-audit.jsonl` 或 `patch-audit.jsonl` 有记录；`tags.add` 幂等（重复执行不产生重复标签）。

---

### P0.2 — UI 观察与导航（MVP-3，2–3 人日）

目标：Agent 能回答「我在哪 / 有什么 / 这个块里是什么 / 我要开什么」。
**不写任何用户数据，不新增前端 handler。**

| # | 命令 | 复用的现成能力 | 本轮新增 |
|---|---|---|---|
| 1 | `wsh ui active` | 后端 `Workspace.ActiveTabId` + **现有** tab 路由 `getfocusedblockdata` | 仅 CLI 组装 + 一次后端查询（无新 FE handler） |
| 2 | `wsh ui state` | `wstore` 直读 window/workspace/tab/block/`LayoutState` + `blockcontroller` 状态 + `agentstatus.Get` | 1 个只读 RPC `UIStateCommand` + snapshot builder |
| 3 | `wsh block read` | `termscrollback` RPC、`file` 读取 RPC、`GetMeta`、`aisessions` 摘要 | **无新后端 RPC**：CLI 按 view 分派 + 有界截断 |
| 4 | `wsh block open` | **现有 `CreateBlockCommand`**（已支持 `TargetAction=replace/split*`、`Magnified`、`Focused`、`SendUpdateEvents`） | **无新后端 RPC**：扩展现有 hidden `createblock` 的 flag |
| 5 | `wsh tab list/create/activate` | `wcore.CreateTab` / `SetActiveTab`（service 层已在用） | 3 个薄 RPC |

**`wsh ui active` 的语义要精确**：它返回两组信息，不能混：

```json
{
  "self":   { "tabId": "tabY", "blockId": "blk7", "blockNum": 3 },
  "active": { "windowId": "win1", "workspaceId": "ws1", "tabId": "tabX",
              "blockId": "blk2", "view": "term", "title": "claude" }
}
```

- `self` = 调用者所在 tab/block（来自 `WAVETERM_TABID/BLOCKID`；外部 token 时为空）。
- `active` = 用户真正在看的窗口/工作区/活动 Tab/焦点 Block（后端 `ActiveTabId` + 该 tab 的 `getfocusedblockdata`）。
- 两者不同正是 Agent 最需要知道的事（「用户在别处看别的块」）。

**Day-1 验收剧本：**

```bash
wsh ui active --json
wsh ui state --json | jq '.blocks | length'
wsh block read 2 --tail 80 --json
wsh block open --view preview --file /repo/README.md --split right --wait --json
```

**完成判据**：`block open` 之后 FE 真的渲染出新块（CDP 验证），`block read` 对 term/preview/web 各自 shape 正确。

---

### P0.3 — 观察面完善（1–2 人日）

- `ui state --live`（新增 tab 路由 `uistatelive`，合并焦点/几何/minimized/magnified）。
- `session list` 的筛选/分页（`ListOptions` 已支持：source/project/tag/marked/limit）。
- `session wait --until idle|blocked|finished`（轮询式，给 Agent 一个「等对方干完」的原语）。
- `wsh agent guide` / `capabilities` + settings 键。

---

### P1 — Common Text、agent 启动、破坏性操作（4–6 人日）

| # | 任务 | 主要文件 |
|---|---|---|
| 1 | `agentdata` 新 operation：`common_text.create/delete/pin` | `pkg/agentdata/patch.go` |
| 2 | `commontext list/get/tags/create/update/delete/pin/use` | `agentcontrol/commontext.go`, `wshcmd-commontext.go` |
| 3 | `inserttext` tab 路由（composer 注入） | `tabrpcclient.ts`, `frontend/app/aipanel/waveai-model.ts` / `frontend/app/view/aisessions/agent.tsx` |
| 4 | `agentlaunch` tab 路由 + `block open --agent-profile` | `tabrpcclient.ts`, `agent-launch.ts` 导出 |
| 5 | `setagentpersona` tab 路由（v1 头像写入） | `tabrpcclient.ts`, `persona-store.ts` |
| 6 | 限流 + 控制面审计 + destructive 开关 | `agentcontrol/{limits,audit}.go` |
| 7 | `block close` / `tab close` / `commontext delete` 的 `--yes` 确认 | `wshcmd-*.go` |

**P1 验收**：Agent 能「读会话 → 整理卡片 → 用 Common Text 起草消息」，且审计完整、误覆盖被拦住。

---

### P1.5 — 外部 Agent 接入（§10.5）

| 阶段 | 交付 | 依赖 |
|---|---|---|
| P1.5a | `wavejwt` claims + `wsh auth grant/list/revoke` + `wsh --token-file` + scope 强制 + 审计/限流按 `jti` | P0.0 `agentcontrol` 骨架 |
| P1.5b | `wsh mcp serve --stdio`（12 tools + 2 resources + annotations） | P1.5a |
| P1.5c | `skills/snorkeling-control/` + 安装脚本 + guide/skill 同源校验 | P1.5a |

---

### P2 — 打磨（按需）

- `ui state --layout` 的批量恢复（多 pane 一键开回）。
- 跨窗口寻址（`--window`）。
- Electron「Agent Access」面板（§10.5.3 B 入口）。
- 宿主插件（pi extension / VS Code / JetBrains，§10.5.7）。
- Agent card persona 后端化（§15 D3）。
- `wsh block open --template <name>`（团队共享布局模板）。

### 实施顺序依赖

```
P0.0 实时会话 ──► P0.1 agent card
      │                 │
      └──► P0.2 看+开 ──┴──► P0.3 观察面 ──► P1 CommonText/agent启动
                                                │
P0.0 骨架 ─────────────────────────────────────► P1.5 外部接入
```

---

## 14. 测试策略

| 层 | 方式 | 重点 |
|---|---|---|
| 单元（Go） | `pkg/agentcontrol/*_test.go` | 快照构建（含 num/leafOrder）、脱敏正则、限流窗口、错误码映射、请求校验（互斥参数） |
| 单元（Go） | `pkg/agentdata/patch_test.go` 扩展 | 新 operation 的字段白名单、前置条件、回滚 |
| 协议 | `cmd/wsh/cmd/*_test.go` | cobra flag 组合、`--json` 输出结构（golden file） |
| 集成（后端） | 用 `wstore` 内存 DB / 临时目录（参照 `aisessions` 现有测试模式） | `block open` → Tab.BlockIds / PendingBackendActions 断言 |
| UI（真机） | `node scripts/inspect-electron-ui.mjs` + CDP | `block open --wait` 后 DOM 真的出现；`uistatelive` 几何正确 |
| 端到端（脚本） | `tests/agent-control/smoke.sh` | 从 Block 内依次执行 §1.1，断言每步 JSON |
| 兼容性 | 旧命令 golden 对比 | `wsh blocks list`、`createblock`、`data apply` 输出不变 |

**必测边界：**
- tab 路由不在线（App 刚启动 / tab 已关）→ `E_NO_ROUTE`，不能 panic。
- 一个 workspace 有 20 个 tab → `--live` 扇出耗时与失败隔离。
- 超长 scrollback（> 2 MB）→ 截断 + `truncated:true`，不 OOM。
- `expectedHash` 过期 → `E_CONFLICT`，且不写入。
- 关闭 `agent:control:enabled` → 所有新命令 `E_FORBIDDEN`，旧命令不受影响。

---

## 15. 风险与开放决策

| # | 风险 / 决策 | 说明 | 建议 |
|---|---|---|---|
| D1 | **「agent card」到底指哪个** | ①AISessions 会话卡（title/note/tags/props/persona）；②Agent Block / profile 的卡片（provider/model）。两者字段不同 | 默认实现 ①（用户日常说「agent card」指的是会话悬浮卡，代码里 `AgentHoverCard` / `tab-more-agent-card` 都是 ①）。②的 profile/model 属于 `agent:profiles` 配置写，放 P2，用 `wsh data` 的配置补丁通道 |
| D2 | **FE 逻辑后置** | `agentlaunch` / `inserttext` / persona 都在 FE，Agent 调时会依赖渲染进程在线 | 显式 `E_NO_ROUTE`；文档写明「需要 Snorkeling 窗口打开」。不做后端复制实现（必然漂移） |
| D3 | **persona 头像无后端真相** | 现状仅 localStorage（`persona-store.ts` / `session-persona-store.ts`），换机器/清缓存即丢 | v1 走 tab 路由写 localStorage；v2 增加 wstore 表 + 一次性迁移（FE 读后端、回退 localStorage）。**建议 P2 做，避免 v1 膨胀** |
| D4 | **快照体积** | `--live --content` 在多 tab 多 block 时可能上百 KB | 默认关 content、默认 256 KB 上限、`--tab` 缩小范围、`blocks` 用扁平索引 |
| D5 | **两条写路径漂移** | ACS 与 service 都调 wcore，容易各写一份参数处理；`BlockOpenCommand` 若粘贴一份 `CreateBlockCommand` 的 layout switch，就是典型漂移源 | spec 约定：ACS 只做参数解析 + 能力检查 + 调用；创建/布局/事件发布**复用** `wshserver.CreateBlockCommand` 与 `wcore`。code review checklist：出现第二个 `LayoutActionDataType_Split*` switch 即拒绝 |
| D6 | **`wsh` 版本与 App 版本不一致** | 旧 `wsh` 打新 RPC 会报「unknown command」 | `wsh --version` + `UIStateCommand` 返回 `apiVersion`；CLI 启动时可选探测，不兼容给明确提示 |
| D7 | **删除能力** | 一旦开放，Agent 可以关掉用户的 tab | 默认关；`--yes` + 审计 + 二次确认（`--yes` 两次？不，一次足够，但需 `agent:control:allowdelete`） |
| D8 | **Common Text 注入的安全** | 把 `rm -rf` 类文本注入终端并回车 | `--into term --submit` 需要 `destructive` 档；默认只允许 `composer`/`clipboard` |
| D9 | **性能** | `ui state` 每秒调用会打满 DB | 限流 + 结果缓存（同一 `generatedAt` 300ms 内复用） |
| D10 | **外部接入用什么形态** | skill / MCP / 插件 / HTTP 常被当成互斥选项 | **四层，不是四选一**：token（必须）→ CLI + MCP（推荐）→ skill（必做）→ 插件（P2 按需）。**不开** 无 token 的本地 HTTP |
| D11 | **外部 token 的生命周期** | 长期 token 泄露面大 | 默认 30m，上限 24h，独立 `jti`，可单删/全撤；权限最小化（默认只给 observe） |
| D12 | **外部 token 的「上下文」** | 外部进程没有 `WAVETERM_BLOCKID/TABID`，`this`/`2` 语义不明 | `this` = 活动 Tab 的焦点 Block（显式回显 `resolvedFrom`）；`2` 等短引用对外部 token 禁用，强制用完整 id |
| D13 | **「实时会话」是否含远程连接块** | 远程 agent 的状态能回流（wsh hook），但摘要/卡片在远端 manager | v1：状态照报，`card=null` + `warnings`；v2 再接远端 manager |
| D14 | **实时会话的判定口径** | 只看 agentstatus 会漏掉「刚启动 hook 未到」；只看 meta 会把已退出进程算活 | 三条件任一（§7.6），并用 `freshness` + `expiresAt` 表达不确定性 |

### 已确认的决策（2026-11-01）

- **优先级**：实时会话（读）→ 会话 agent card（写）→ UI 观察/导航 → Common Text → 外部接入。见 §13.0。
- **「agent card」= 会话卡**（title/note/tags/props + 后续 persona），不是 agent 块/profile 卡（D1 已定）。
- **外部接入**按「token → CLI + MCP → skill → 插件」推进（D10 已定）。

### 仍需拍板

1. **破坏性操作是否开放给 Agent？**（默认关闭，只开 observe/navigate/data）
2. **外部 token 默认 scope**（推荐只给 `observe`；`navigate`/`data` 需 `wsh auth grant` 时显式列出）
3. **agent card 的 `--prop` 是否允许覆盖 `source=user` 值**（推荐：默认跳过，`--force` 才覆盖）

---

## 16. 附录：命令速查（v1 目标态）

```bash
# ── 观察 ──────────────────────────────────────────────
wsh ui active --json
wsh ui state --json [--live] [--content] [--tab <id>]
wsh ui find --view term --json
wsh ui focus --block 2 --tab tab:1

# ── 结构 ──────────────────────────────────────────────
wsh tab list --json
wsh tab create --name scratch --activate --json
wsh tab activate <tabid>
wsh block open --view term --tab new --cwd /repo --wait --json
wsh block open --view preview --file /repo/README.md --split right --json
wsh block open --view agent --tab active --focus --json
wsh block open --agent-profile codex --agent-model gpt-5-codex --tab active --json
wsh block move 2 --to-tab tab:1 --activate
wsh block copy 2 --to-tab new --json
wsh block read 2 --tail 80 --json
wsh block read this --lastcommand

# ── 会话 ──────────────────────────────────────────────
wsh session list --source pi --limit 10 --json
wsh session get 019a… --json
wsh session get this --detail --json
wsh session live --json

# ── Agent card ────────────────────────────────────────
wsh agent card get this --json
wsh agent card set 019a… --note "已整理" --tags-add 已整理 --dry-run
wsh agent card set 019a… --note "已整理" --tags-add 已整理 --yes

# ── Common Text ───────────────────────────────────────
wsh commontext list --tag prompt --json
wsh commontext get <id> --json
wsh commontext use <id> --into composer --block this
wsh commontext use <id> --into clipboard
wsh commontext create --title "Review" --text @review.md --tags prompt --dry-run
wsh commontext update <id> --tags-add 常用 --yes

# ── 可发现性 ──────────────────────────────────────────
wsh agent guide
wsh agent guide --json
wsh agent capabilities --json

# ── 外部 Agent 接入（§10.5）─────────────────────────────
# 在 App 内的 Block 里执行：
wsh auth grant --name codex-external --scope observe,navigate --ttl 30m \
               --out ~/.config/snorkeling/agent-token.json
wsh auth list
wsh auth revoke --all

# 在 App 外（iTerm / 另一个终端 / IDE 终端）执行：
wsh --token-file ~/.config/snorkeling/agent-token.json ui active --json
wsh --token-file ~/.config/snorkeling/agent-token.json block open \
    --view preview --file /repo/README.md --tab active --json
wsh mcp serve --stdio --token-file ~/.config/snorkeling/agent-token.json
```

---

## 17. 与现有任务的关系

| 现有任务 | 关系 |
|---|---|
| `10-24-aisessions-quote-to-composer` | `inserttext` tab 路由与其共享；建议先落地该任务的 composer 插入原语，ACS 复用 |
| `10-25-aisessions-ai-gen`（note/tags 生成） | `agent card set` 复用同一写入语义与 `titleSource` 保护 |
| `10-29-agent-avatar-text-badge` | `setagentpersona` 与头像解析链（`getAgentIcon`）共享；若 P2 后端化，两者一起改 |
| `10-26-tab-startup-restore` | `ui state --layout` 与 tab 还原共享 LayoutState 读取语义 |
| `docs/project/agent-data-patch.md` | 新增 operation 后必须同步该文档与 `agentcap` guide/schema |

---

## 18. 决策记录（ADR 摘要）

| ADR | 决策 | 理由 |
|---|---|---|
| ADR-1 | 传输只走 `wsh` RPC，不开 HTTP | Block 级 JWT 已就绪；避免把浏览器 authkey 暴露给子进程 |
| ADR-2 | 读直连 wstore，写直连 wcore | 同进程，零序列化开销；与 service 层同源 |
| ADR-3 | 写用户数据一律转 patch | 免费获得 dry-run/备份/回滚/审计/前置条件 |
| ADR-4 | UI 实时状态走 tab 路由扇出 | 只有渲染进程知道真实焦点/几何；后端 LayoutState 有 debounce 延迟 |
| ADR-5 | Agent 启动留在 FE | profile/cc-switch/autoresume 组装逻辑已在 FE；复制必漂移 |
| ADR-6 | 破坏性操作默认关闭 | 最小的「默认安全」面；用户显式打开 |
| ADR-7 | 不加 MCP（v1） | 先固化 CLI 契约；MCP 是纯门面，后期一层包装即可 |
