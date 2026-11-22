# PRD：Overview Tab 分组修复 + 卡片发送 + 新建 Tab

> 状态：planning。父任务只持有需求源、任务地图与跨子包验收；实现落在三个子包。
> UX 草图（ASCII，已与 nita 对齐）：见本任务 `ux-ascii.md`。

## Goal

把 Overview 从「只能看、还看不全」推进到「能看全、能直接指挥、能建新 Tab」：
1. **看得全** —— Tab 分组不再因为「没内容 / 没打开 / 未加载 / agent 过滤」而整组消失。
2. **能指挥** —— 点 agent 卡展开详情并就地输入发送，回复回填，全程不抢焦点。
3. **能扩张** —— Overview 里直接新建 Tab（空 / 空+Agent / 模板）。

## 问题证据（2026-11-22 核实）

| 现象 | 代码锚点 | 机制 |
|---|---|---|
| 没打开过的 Tab 不显示 | `frontend/app/session-overview/session-overview.tsx:2250-2265` | `displayedTabGroups` 末尾 `filter(group => group.blocks.length > 0)` 删空组 |
| 只有 Overview 块的 Tab 自己消失 | `session-overview.tsx:346` | `useOverviewBlocks` 主动 `continue` 跳过 `view === "sessionoverview"`，该组块数归 0 后被删 |
| 首次渲染大量 Tab 闪没 | `session-overview.tsx:328` + `frontend/app/store/wos.ts:226` | 每个块单独 `GetObjects`（一 Tab 约 10 块，19 Tab ≈ 190 次串行），首帧全 `null` |
| 开 Agent 过滤器整组消失 | `session-overview.tsx:2252-2263` | 先 `blocks.filter(isAgentLike)` 再 `blocks.length > 0` → 无 agent 的 Tab 组被删 |
| 卡片不可发送 | `overview-board.tsx` 只有 「跳转/备注/关闭」热区 | 缺 composer；后端 `AgentSendCommand`（含 11-21 `--wait-reply`）已具备 |
| 不能新建 Tab | Overview 工具栏只有视图/分组/过滤/条数 | 缺入口；`createTab()` 与 `agent launch --tab` 已具备 |

数据库实测（`~/AppData/Local/snorkeling/Data/db/waveterm.db`）：33 个 Tab、267 个块，两 workspace 分别 19/14 个 Tab ——
**所有 Tab 都有 blockids**，所以问题不在数据，在渲染层过滤与加载策略。

## 需求（跨子包）

### R1 Tab 分组常驻（子包 `11-22-overview-tab-grouping`）
- R1.1 组从 `workspace.tabids` 生成，**不再因为块数为 0 被删除**。
- R1.2 未打开（本次启动未激活过）的 Tab 显示为灰行并可一键打开。
- R1.3 块对象批量拉取（一次 `GetObjects`），首帧未就绪的组显示骨架而非消失。
- R1.4 `hideUnopenedTabs` 只决定「是否显示未打开灰行」（关＝显示，开＝隐藏，这是它唯一的删组权力）；`agentsOnly` 只过滤组内行，永不影响组头数量。

### R2 卡片发送（子包 `11-22-overview-card-send`）
- R2.1 点击卡片主体原地展开：属性行 + 最近回复 + composer。
- R2.2 发送走既有派发队列（`queued → sent → confirmed`），可选「等回复」（11-21 `--wait-reply` 语义）。
- R2.3 失败原地显示错误码与「重试 / 改为不等待」，不弹模态。
- R2.4 不抢焦点、不切换 Tab；`[↪]` 保留跳转。

### R3 新建 Tab（子包 `11-22-overview-new-tab`）
- R3.1 入口两处：工具栏「＋ 新建 Tab」、组列表尾部「＋ 新建 Tab」。
- R3.2 弹窗三选一：空 Tab / 空 Tab + Agent(默认 provider) / 从模板；可选名称。
- R3.3 创建后原地插入该 Tab 的组行，不整页刷新。

## 任务地图

| 子包 | 优先级 | 交付 | 依赖 |
|---|---|---|---|
| `11-22-overview-tab-grouping` | P0 | 组常驻 + 灰行 + 骨架 + 批量取块 | 无（先做，其余两包 UI 落在新分组上） |
| `11-22-overview-card-send` | P1 | 卡片展开 + composer + 三段回执 + 回填 | 与 11-21 派发队列对齐（已完成） |
| `11-22-overview-new-tab` | P2 | 两处入口 + 三选一弹窗 | 复用 `createTab()` / `agent launch --tab`（11-20 已交付） |

## 已拍板决策（2026-11-22）

- **A** 卡片点击 = 原地展开详情 + composer；跳转保留 `[↪]` 小热区。
- **B** 空 Tab / 未打开 Tab 默认折叠成一行灰行（不展开）。
- **C** 新建 Tab 入口两处都放（工具栏 = 全局建，组尾 = 就近建）。

## 跨子包验收

- 三个子包各自带判据（数字），合并后跑一次真机验证台 `overview-ux`（新增 area）：
  `Tab 组数 == workspace.tabids 数`、`开 Agent 过滤器后组数不变`、`卡片发送后出现 confirmed`、
  `新建 Tab 后 tabids +1`。四条全绿才算父任务完成。

## 不做（明确出界）

- 不改 `workspace.tabids` / `pkg/wcore/workspace.go` 数据层。
- 不重做 Overview 看板/时间线视觉（那是 11-04/11-05 系列）。
- 不给卡片加富文本编辑器，composer 是纯文本单行/多行输入。
- 不做 Tab 拖拽排序（Tab 栏已有）。
