# Agent Control Surface（ACS）契约

> 本项目「本地 Agent 受控读取/操作 Snorkeling」的唯一入口约定。
> 设计母文档：`design/plans/agent-control-surface.md`；实现说明：`docs/project/agent-control-surface.md`。
> 代码：`pkg/agentcontrol/`、`pkg/wshrpc/wshserver/{ui,block,tab,session}_commands.go`、`cmd/wsh/cmd/wshcmd-{ui,block,tab,session,agent-card}.go`。

---

## 1. 分层职责（谁可以做什么）

| 层 | 职责 | 禁止 |
|---|---|---|
| `pkg/agentcontrol` | 数据组装、脱敏、有界截断、错误码 | 发 wps 事件、写用户数据（`agentdata.ApplyPatch` 除外） |
| `pkg/wshrpc/wshserver/*_commands.go` | 薄转发；`BlockOpenCommand` 这类**编排**（解析 → 校验 → 调既有能力 → 富化结果） | 复制 `objectservice`/`wcore` 的参数处理 |
| `pkg/wcore` | 「DB 写 + 事件发」的组合、被 ACS 与 service 共用 | 依赖 `agentcontrol` |
| `cmd/wsh/cmd` | flag 解析、输出格式（`--json`）、退出码 | 业务判断、直接摸 DB |

**硬规则**

1. **ACS 不得在 wshserver 里复制 objectservice 的参数处理**，只做「参数解析 + 能力检查 + 调 wcore + 组装结果」。
2. **任何「DB 写 + 事件发」的组合必须留在 `wcore`**；ACS 不自己发 `wps` 事件（否则事件顺序会与 UI 路径漂移）。
3. **新增字段优先加在 `wcore` 函数签名上**，让 service 与 ACS 同时受益（例：`wcore.ListBlocksScoped`）。
4. **不得出现第二套写路径**：写用户数据只能翻译成 `agentdata.Patch` 并走 `agentdata.ApplyPatch`（备份 + 审计 + 前置条件）。

---

## 2. 遍历只有一个实现：`wcore.ListBlocksScoped`

`wsh blocks list` 与 `wsh ui state` **共用** `wcore.ListBlocksScoped`（`pkg/wcore/blockscope.go`）。

- 历史上 `BlocksListCommand` 自己走了一遍 window→workspace→tab→block；`ui state` 若再走一遍就会漂移
  （一处修了 block 过滤、另一处没修）。
- 新增「列出块」的需求，**只允许**给 `ListBlocksScoped` 加参数/字段，不允许另写一个 walk。
- 回归保护：`pkg/wcore/blockscope_test.go`。

---

## 3. 读取一律有界 + 脱敏

1. **block meta 只能经 `agentcontrol.RedactMeta` 出去**（白名单，非黑名单）。meta 里可能出现
   `cmd:env`、带 key 的 URL，黑名单必漏。
2. **内容读取必须有双上限**：行数（`--tail`，默认 80 / 硬上限 2000）与字节（`--max-bytes`，默认 64 KiB），
   并且回报 `truncated` 与截断前 `bytes`，让 Agent 能分辨「真的没有」与「被截断」。
3. **不可读不是错误**：前端路由不可达、远程文件、unknown view 一律降级为 `warnings` / `payload.error`，
   进程仍 exit 0。Agent 拿到结构化信息比拿到失败更有用。
   - 例外：block 不存在 → `E_NOT_FOUND`；参数矛盾 → `E_USAGE`。
4. **禁止 N 个会话 = N 次扫描**：读会话摘要只能走 `aisessions.Manager.ResolveSummaries`
   （见 `aisessions-scan-contract.md`），不得在循环里调 `Manager.Summary`。

---

## 4. 前端路由调用必须可注入

ACS 需要读前端真相（焦点块 `getfocusedblockdata`、终端回滚 `termgetscrollbacklines`），
走 `wshrpc.RpcOpts{Route: wshutil.MakeTabRouteId(tabId)}`。

**`wshclient.GetBareRpcClient()` 在测试进程里会 panic**（`WshRouter` 未初始化），因此这类调用
必须收成包级变量以便替换：

```go
var focusedBlockDataFn = func(tabId string) (*wshrpc.FocusedBlockData, error) { ... }
var termScrollbackFn   = func(tabId string, data wshrpc.TermScrollbackData) (*..., error) { ... }
```

新增第 3 条前端路由调用时照此办理；不要在 `agentcontrol` 里直接硬调 `GetBareRpcClient()`。

---

## 5. `wsh ui active` 的 self / active 必须分开

`self`（调用者所在 tab/block，来自 `WAVETERM_TABID` / `WAVETERM_BLOCKID`）与
`active`（用户真正在看的 window/workspace/activeTab/focusedBlock）**必须是两个对象**。

合成一个对象就丢失了「用户在别处看别的块」这个 Agent 最需要的信号，且无法表达
「外部调用没有 self」。字段语义见 `wshrpc.UIActiveSnapshot`。

---

## 6. `--wait` 只看后端真相

- `tab create/activate --wait`：轮询 `Workspace.ActiveTabId == tabId`，不看前端声称。
- `block open --wait`：轮询 `wcore.LayoutAppliedToFrontend` = 布局动作队列排空 **且** `leaforder` 含该块。
  **不能用 `tab.BlockIds` 含该块作为判据**：后端写完行就成立，前端可能还没消费动作
  （2026-11-08 实测 `BlockIds=4` 而 `leaforder=1`）。
- 三态：`db-only`（未 `--wait`）/ `layout-queued`（超时，写入成功但前端未应用，带 `layout-not-applied`）/
  `layout-applied`。把未渲染的情况报成 `layout-applied` 等于对 Agent 说谎。
- 超时进 `warnings`，**不报错**（写入已经成功）。

---

## 7. 错误码冻结

`pkg/agentcontrol/errors.go` 的 `Code*` 常量是 Agent 的分支依据，**只加不改**：
`E_USAGE` / `E_NOT_FOUND` / `E_CONFLICT` / `E_FORBIDDEN` / `E_UNSUPPORTED` / `E_NO_ROUTE` / `E_TIMEOUT` / `E_INTERNAL`。

CLI 必须把 `Code` 映射成稳定退出码，`--json` 时输出结构化错误（`code` / `message` / `hint`）。

---

## 8. 新增一个面（checklist）

1. DTO 加到 `pkg/wshrpc/wshrpctypes.go`（紧跟既有 `Session*` / `UI*` 分组），interface 加方法。
2. handler 放 `pkg/wshrpc/wshserver/<area>_commands.go`，薄转发；编排型（如 `BlockOpenCommand`）写清楚复用哪条既有能力。
3. CLI 放 `cmd/wsh/cmd/wshcmd-<area>.go`，`--json` + `--timeout` 与既有命令一致。
4. `node scripts/run-task.mjs generate` 刷新 `wshclient` / `gotypes.d.ts` / `wshclientapi.ts`
   （**只允许新增行**；出现删除说明手改了生成物或改坏了既有类型）。
5. 广告到 `pkg/agentcap`（`GuideText` / `ExternalAgentPrompt`）——不可发现的命令等于不存在。
6. 改动了线上形状 → 更新 `pkg/agentcontrol/testdata/*.golden.json`。
7. 纯逻辑单测 + DB fixture 测试（`ui_e2e_test.go` 的 `setupUIStore` 模式）+ 低成本 golden。

---

## 9. card 写入的备份粒度（数据安全）

`agent card set` 的真实写入走 `agentdata.ApplyPatch`，**备份成本必须与操作范围成正比**，
不能与数据库体积挂钩。

| 规则 | 原因 |
|---|---|
| 默认写 `kind=rows` 的行级快照（`*.rows.sqlite`），只含本 patch 能触及的行 | 整库 `VACUUM INTO` 在 2.8 GB 索引上必然超 `--timeout 15s`（2026-11-09 真机 `EC-TIME`），且要求等于索引体积的空闲磁盘 |
| 回滚只 `DELETE`+`INSERT` 快照内的 key | 整表快照回滚会抹掉其它会话在 patch 期间的并发写入 |
| `ai_session_props` 必须出现在恢复语句里 | 它和 note/title 一样会被 patch 写，漏了就是「付了保费却漏保」 |
| 影响行数 > `scopedBackupRowLimit`(5000) 或 `SNORKELING_AGENTDATA_BACKUP_MODE=full` → 退回整库备份 | `tag.rename` 可能命中全部会话；且必须留一条不改代码的降级路 |
| 无 `kind` 字段的历史备份继续走整表恢复 | 旧备份不能因为改粒度而失效 |

判据（改动此路径时必须重新采数）：单会话 note/标签写入 **< 2 s**、新增备份文件 **< 1 MB**、
`patch-audit.jsonl` 里 `success:true` 且 `operations` 非 null。
