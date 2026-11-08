# 技术设计：Agent Control Surface P0.2（UI 观察与导航）

关联 PRD：同目录 `prd.md`
母设计：`design/plans/agent-control-surface.md` §6.1–6.3、§7.1–7.3、§8.1、§13 P0.2
前置交付：P0.0（`pkg/agentcontrol/{live,session,redact,errors}.go`）、P0.1（`card.go`）

---

## 1. 边界与总体形状

```
cmd/wsh/cmd/
  wshcmd-ui.go        ← 新增：ui active / ui state
  wshcmd-block.go     ← 新增：block read（block open 见 §5）
  wshcmd-tab.go       ← 新增：tab list/create/activate
pkg/agentcontrol/
  ui.go               ← 新增：UIStateSnapshot / UIActiveSnapshot builder + 有界内容读取
  ui_test.go
  testdata/ui_state.golden.json
pkg/wcore/
  blockscope.go       ← 新增：ListBlocksScoped（从 wshserver.BlocksListCommand 抽出）
pkg/wshrpc/wshrpctypes.go     ← 新增 UI*/Block*/Tab* DTO + interface 方法
pkg/wshrpc/wshserver/
  ui_commands.go      ← 新增：薄只读 handler
  block_commands.go   ← 新增：BlockReadCommand / BlockOpenCommand
  tab_commands.go     ← 新增：Tab* handler
```

**硬规则（写进 spec）**

1. ACS **不复制** `objectservice` 的参数处理；也不复制 `wshserver.BlocksListCommand` 的遍历。
2. 「DB 写 + 事件发」的组合必须留在 `wcore`；ACS 不自己发 `wps` 事件。
3. 新增字段优先加在 `wcore`/`wstore` 函数签名上，让 service 与 ACS 同时受益。
4. 读接口一律走 `agentcontrol.RedactMeta` 白名单，不整包透传 meta。

---

## 2. 复用点（先摆清楚，避免重复造）

| 需要的能力 | 现成实现 | 位置 |
|---|---|---|
| 窗口/工作区/tab/block 遍历 | `BlocksListCommand` 里的 walk | `pkg/wshrpc/wshserver/wshserver.go:1053` |
| 当前活动 tab | `Workspace.ActiveTabId` | `pkg/waveobj/wtype.go:181` |
| 焦点块 | tab 路由 `getfocusedblockdata` → `FocusedBlockData` | `frontend/app/store/tabrpcclient.ts:109` |
| 终端回滚 | `TermGetScrollbackLinesCommand` | `pkg/wshrpc/wshrpctypes.go:230`、后端经 `RpcOpts{Route: wshutil.MakeTabRouteId(tabId)}` 转发（范式见 `pkg/aiusechat/tools_screenshot.go:42`） |
| 块运行态 | `blockcontroller.GetBlockControllerRuntimeStatus(blockId)` | `pkg/blockcontroller/blockcontroller.go:342` |
| 块内 agent 状态 | `agentstatus.Get(blockId)` | P0.0 已用 |
| 建块 | `wshserver.CreateBlockCommand`（已支持 replace/split*/Magnified/Focused） | `wshserver.go:380` |
| 建/激活 tab | `wcore.CreateTab` / `wcore.SetActiveTab` | `pkg/wcore/workspace.go:296` / `:426` |

**注意**：`agentstatus.Get` / `blockcontroller` / `wcore` 都不依赖 `agentcontrol`，`agentcontrol` 也不被它们依赖 → 无循环导入风险。

---

## 3. `wsh ui active`（R1）

### 3.1 数据来源

| 字段 | 来源 | 失败降级 |
|---|---|---|
| `self.tabId` | env `WAVETERM_TABID` | 空（外部调用） |
| `self.blockId` | env `WAVETERM_BLOCKID` | 空 |
| `active.windowId` | `wstore.DBGetSingleton[*waveobj.Client]` → `WindowIds[0]` | `null` |
| `active.workspaceId` | `wcore.GetWindow(windowId).WorkspaceId` | `null` |
| `active.tabId` | `wcore.GetWorkspace(wsId).ActiveTabId` | `null` |
| `active.blockId` | tab 路由 `getfocusedblockdata`（`MakeTabRouteId(activeTabId)`） | `null` + `warnings: ["focused-block-unavailable"]` |
| `active.view`/`title` | 该 block 的 meta（走 `RedactMeta`） | 空 |

### 3.2 DTO

```go
type UIActiveRequest struct {
    BlockId string `json:"blockid,omitempty"` // self 覆盖（外部调用无 env 时）
    TabId   string `json:"tabid,omitempty"`
}

type UIActiveSnapshot struct {
    Version     int              `json:"version"`     // 1
    GeneratedAt int64            `json:"generatedat"`
    Self        UIActiveSelf     `json:"self"`
    Active      *UIActiveTarget  `json:"active"`      // 可为 null（后端不可达）
    Warnings    []string         `json:"warnings,omitempty"`
}

type UIActiveSelf struct {
    TabId    string `json:"tabid,omitempty"`
    BlockId  string `json:"blockid,omitempty"`
    BlockNum int    `json:"blocknum,omitempty"`
}

type UIActiveTarget struct {
    WindowId    string `json:"windowid,omitempty"`
    WorkspaceId string `json:"workspaceid,omitempty"`
    TabId       string `json:"tabid,omitempty"`
    TabName     string `json:"tabname,omitempty"`
    BlockId     string `json:"blockid,omitempty"`
    View        string `json:"view,omitempty"`
    Title       string `json:"title,omitempty"`
}
```

`self` 与 `active` **必须分成两个对象**：Agent 最常问的正是「用户在看哪儿、我在哪儿，两者是否不同」。合成一个对象就丢了这个信号。

`blockNum` 来自 tab `LayoutState` 里的 leaf 序号；解析失败则省略（不报错）。

---

## 4. `wsh ui state`（R2）

### 4.1 复用改造：`wcore.ListBlocksScoped`

把 `BlocksListCommand` 里的遍历原样搬到 `pkg/wcore/blockscope.go`：

```go
// 与 BlocksListCommand 完全同源，只是从 handler 变成可复用函数。
func ListBlocksScoped(ctx context.Context, scope BlocksScope) ([]wshrpc.BlocksListEntry, error)

type BlocksScope struct {
    WindowId    string
    WorkspaceId string
}
```

`BlocksListCommand` 改为一行调用 → **行为零变化**（AC10 回归保护）。`agentcontrol.BuildUIState` 也调它 → **只有一份遍历逻辑**。

> 这是本批唯一动到既有 handler 的改动，风险最低的形态：同一函数、同一返回值、同一条测试。

### 4.2 Snapshot 构建

```go
type UIStateRequest struct {
    WindowId    string `json:"windowid,omitempty"`
    WorkspaceId string `json:"workspaceid,omitempty"`
    IncludeIdle bool   `json:"includeidle,omitempty"`
}

type UIStateSnapshot struct {
    Version     int          `json:"version"`      // 1
    GeneratedAt int64        `json:"generatedat"`
    Windows     []UIWindow   `json:"windows"`
    Tabs        []UITab      `json:"tabs"`
    Blocks      []UIBlock    `json:"blocks"`
    Sources     UISources    `json:"sources"`
}
```

`blocks[]` 每项：

```json
{
  "blockid": "blk7", "blocknum": 3,
  "view": "term", "title": "claude",
  "tabid": "tabX", "workspaceid": "ws1",
  "controller": "shell",
  "runtime": { "shellprocstatus": "running", "tsunamiport": 0 },
  "agent":   { "state": "working", "phase": "tool", "freshness": "fresh" },
  "meta":    { "view": "term", "connection": "" }
}
```

- `meta` 只放 `RedactMeta` 的白名单子集。
- `agent` 复用 P0.0 的 `agentstatus` 读取，不重新合并 live 源（那是 `session live` 的职责，`ui state` 只带块级状态，避免两套合并逻辑）。
- 默认 `sources = { "backend": "ok", "live": "not-requested" }`（`--live` 属 P0.3）。

### 4.3 成本

一次 `ListBlocksScoped`（每个 tab 一个 `DBMustGet`）+ 每个 block 一次 `blockcontroller.GetBlockControllerRuntimeStatus`（内存 map 查询）+ 一次 `agentstatus.Get`（内存）。**无 SQLite 扫描、无 `Manager.Summary`**，符合 `aisessions-scan-contract.md`。

---

## 5. `wsh block read` / `wsh block open`（R3/R4）

### 5.1 `block read` 分派

```go
type BlockReadRequest struct {
    BlockId     string `json:"blockid"`
    Tail        int    `json:"tail,omitempty"`      // 默认 80，硬上限 2000
    MaxBytes    int    `json:"maxbytes,omitempty"`  // 默认 65536
    LastCommand bool   `json:"lastcommand,omitempty"`
}
```

| view | 实现 |
|---|---|
| `term` | `TermGetScrollbackLinesCommand` 经 `RpcOpts{Route: MakeTabRouteId(tabId)}`；`LineStart = max(0, total-tail)`。FE 不在线 → `warnings: ["term-route-unavailable"]` + 空 lines，**不报错** |
| `preview` / `edit` | 读 `meta.file`；远端（`meta.connection` 非空）走 fileshare，本批先返回 `warnings: ["remote-file-unsupported"]` |
| `web` | `meta.url`；`title` 需 live，本批留空 |
| `agent` | `ResolveSessionForBlock` + P0.0 的 live 记录（不调 `Manager.Summary` 循环） |
| 其它 | `payload.error = "unsupported view"`，仍返回 meta/runtime，**exit 0** |

截断统一在 `agentcontrol.TruncatePayload`：按 `maxbytes` 截字节、按 `tail` 截行，置 `truncated=true` 并回报 `bytes`（截断前真实大小）。

### 5.2 `block open` 编排

`BlockOpenCommand` 是**编排层**，不重新实现创建：

1. 解析 `--tab active|new|<id>`：`new` → 先 `wcore.CreateTab`。
2. meta 白名单校验（只允许 `RedactMeta` allowlist 的键，另加显式白名单外的 `file/url/cwd/connection` 写入键）。
3. `--dedupe`：在目标 tab 的 block 里找 `view` + 签名 meta 相同的，命中直接返回。
4. 调 `ws.CreateBlockCommand(ctx, CommandCreateBlockData{...})`（`TargetAction` 映射 `--split/--replace`）。
5. `--wait`：轮询 block 是否出现在 tab `LayoutState`，超时走 `E_TIMEOUT`。
6. 富化 `blockNum` / `syncState`（`db-only` → `layout-applied`）。

`--view agent`（GUI 对话块）与 `--agent-profile`（TUI）**不在本批**（依赖 tab 路由 `agentlaunch`，属 P1 第 4 项）。

---

## 6. `wsh tab list/create/activate`（R5）

| 命令 | 实现 |
|---|---|
| `tab list` | `wcore.GetWorkspace` → `TabIds` → 每个 `DBMustGet[*waveobj.Tab]`；带 `active` 标记（对比 `ActiveTabId`） |
| `tab create` | `wcore.CreateTab(ctx, wsId, name, activate, isInitialLaunch=false)` |
| `tab activate` | `wcore.SetActiveTab(ctx, wsId, tabId)`；`--wait` 轮询 `Workspace.ActiveTabId == tabId`，默认 1500ms |

`--wait` 判定**只看后端真相**，不看 FE 声称的激活状态——这样 FE 未运行时语义仍然正确。

---

## 7. 错误语义

沿用 `pkg/agentcontrol/errors.go`，不新增码：

| 场景 | 码 | 说明 |
|---|---|---|
| 缺 block id / 参数矛盾 | `E_USAGE` | CLI 侧先行校验 |
| block/tab 不存在 | `E_NOT_FOUND` | 带 hint |
| view 不支持 | `E_UNSUPPORTED` | **但 `block read` 走 payload.error，exit 0**（Agent 拿到结构比拿到失败更有用） |
| FE 路由不可达 | 降级 | `warnings`，不失败 |
| `--wait` 超时 | `E_TIMEOUT` | |
| 破坏性操作 | — | 本批不含 |

---

## 8. 测试策略

| 层 | 内容 |
|---|---|
| 单测 `pkg/agentcontrol/ui_test.go` | snapshot 组装（给定 blocks/runtime/agent 输入 → 期望 JSON）、`RedactMeta` 生效、`self` vs `active` 分离、降级 warnings、`TruncatePayload` 边界（0/负数/超 maxbytes） |
| golden `testdata/ui_state.golden.json` | 冻结字段名与 null-vs-omit 语义（与 P0.0 的 golden 同风格） |
| 单测 `pkg/wcore/blockscope_test.go` | `ListBlocksScoped` 与 `BlocksListCommand` 结果一致（回归保护 AC10） |
| CLI 单测 | `--split` → `TargetAction` 映射表；`--tab new` 走 CreateTab；参数互斥报 `E_USAGE` |
| 真机 | AC7（CDP 确认新块渲染）、AC8（dedupe）、AC9（激活后后端真相） |

不新增前端 handler → 前端只随 `task generate` 更新绑定文件（AC12）。

---

## 9. 风险与取舍

| 风险 | 处理 |
|---|---|
| 抽 `ListBlocksScoped` 改到既有 handler | 同一函数、同一返回值；加 `blockscope_test.go` 对比测试兜底 |
| `block read` 依赖 FE 路由（term scrollback） | 明确降级为 `warnings` + 空内容，绝不阻塞；`syncState`/`warnings` 让 Agent 能分辨「真没内容」与「读不到」 |
| `ui state` 在 block 很多时输出过大 | 默认不带内容（`--content` 属后续批次）；`--include-idle=false` 过滤空闲块 |
| `block open --wait` 轮询实现 | 只轮询后端 `LayoutState`（DB 真相），不依赖 FE 回执；超时上限 5s，默认 0（不等） |
| 与 P0.0 重复维护 agent 状态读取 | `ui state` 复用 `agentstatus.Get` 与 P0.0 同一函数，合并逻辑仍只在 `live.go` 一处 |

---

## 10. 兼容性

- 所有新命令是新 root 子命令，既有 `wsh blocks/createblock/deleteblock/focusblock/session/agent card` 行为不变。
- `wshrpctypes.go` 只**新增**方法，不改既有签名 → `task generate` 只产生增量 diff。
- `BlocksListCommand` 签名与返回值不变（内部实现改为调用 `wcore.ListBlocksScoped`）。
