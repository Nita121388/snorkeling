# Overview 时间线（甘特）设计

> 状态：**G1 / G2.1 已落地**；**G2 待环形历史**；**G3 按对话轮拆分 = 原型阶段（未实现）**，见 §8。
> 按轮原型：`design/prototypes/overview-dashboard/overview-board-v2/turn-gantt.html`
> 上游：`11-05-overview-board-v2`（卡片信息架构 + 5 列看板已发）、`11-05-overview-board-view-switch`（视图三段切换已留接口）、
> `11-25-overview-turn-gantt`（G3 原型包）。
> 日期：2026-11-05（G1/G2），2026-11-25（G3）

## 1. 目标与非目标

**目标**：一眼回答「每个 agent 起了多久、什么时候停的、现在还活着吗」。

**非目标**：不做资源利用率、不做计划 vs 实际对比、不做跨天甘特排期（这是 agent 会话，不是项目任务）。

## 2. 数据现状（决定能做哪一版）

| 字段 | 来源 | 说明 |
|---|---|---|
| `createdAt` | `SessionSummary` | 会话文件创建时间（部分历史会话缺失） |
| `updatedAt` | `SessionSummary` | 最后一条消息时间 |
| `messageCount` / `projectPath` / `title` | `SessionSummary` | 卡片已有信息 |
| `live` | `SessionSummary` | 是否仍在写入 |
| `state` / `phase` / `activeSince` / `updatedAt` / `completedAt` | `AgentStatus` | **只有当前态** |
| 历史状态转移 | ❌ 不存在 | 这是 G2 唯一的阻塞点 |

结论：**G1 零埋点可做；G2 需要新增 per-block 状态历史。**

## 3. G1 · 会话寿命条（推荐先做）

- 每条 = `createdAt → (live ? now : updatedAt)`
- 尾巴最后一小段用**当前状态色**（与列头色点、卡片 chip 同一套 `--agent-*` token）
- 历史段用中性斜纹 + tooltip 注明 `状态未知`
- `createdAt` 缺失时从 `updatedAt` 起算，tooltip 标 `start unknown`
- 排序：最后活动时间倒序；超窗的会话灰显排底并在行尾给「更早」箭头

## 4. G2 · 状态分段（后续，独立可回滚）

**存储**：`agent-status` 侧新增环形历史

```
key:   snorkeling:agent-status-history
value: { [blockId]: Array<{ t: number; s: string; p?: string }> }   // t=ms, s=state, p=phase
cap:   每块 200 条（约 8KB），全局 1MB 上限 + LRU 淘汰最旧块
write: 只在 presented 状态变化时 append（唯一写点，避免高频抖动的 re-render 写盘）
```

**读取**：纯函数 `buildTimelineSegments(history, window, now)` → `[{state, fromMs, toMs, inferred}]`
（窗口裁剪、缺口补 `unknown`、首段用 `createdAt` 补齐），可直接单测。

**渲染**：与 G1 共用同一份 `segments` 模型 —— G1 就是「单段 unknown + 尾巴当前态」，所以 G2 落地时**组件结构不变**。

## 4.5 G2.1 · 已落地的退化分段（2026-11-06，task 11-06-overview-optimize-1to4）

**结论先说**：G2 需要后端环形历史，但「猜尾巴」这一步**不需要等后端**就能修好。
G2.1 用三个已有真实字段切段，已实现并通过真机验证（`overview-timeline` ✅ 27/27）。

```
[startedAt ──── activeSince)   unknown   ← 不知道自己当时在干什么（斜纹）
[activeSince ── endedAt]       当前状态   ← AgentStatus.activeSince 起算
```

- `activeSince` 是后端在同一 state 连续上报时**保留的首个时刻**（`agentstatus.go:329`），
  所以它就是「这个状态真实开始的时间」，不是估算。
- `completedAt` 进模型，画成竖刻度（`.bar-completed`），hover 显示 `HH:MM 完成`。
- `idle` 段用中性灰实心，宽度 = `now − completedAt` —— 「空闲多久」终于可读。
- **替换掉的旧算法**：`tailMsFor = max(6min, min(span*20%, 30min))`（`overview-timeline-model.ts:113`），
  与真实状态切换无关，是「运行阶段/完成点永远读不对」的根因。

**残留不诚实之处（必须写进 UI）**：仍画不出 `working → idle → working → idle` 的多次交替。
`overview-timeline.tsx` 的图例 hint 的 tooltip 已写明。要真正画出来需要 §4 的环形历史，
届时只需给 `buildTimelineSegments` 传 `history` 参数 —— **渲染层与组件结构不用改**（这一点在 §3 就已预留）。

**后端记录点（做 §4 时的唯一正确位置）**：`statusManager.report()` 内部（能拿到 prev/next）。
**不要在前端订阅 `agentstatus` 事件累积**：`sameStatus()` 把 `UpdatedAt/ActiveSince` 排除在比较外
（`agentstatus.go:539`），同 state 只改 `ActiveSince` 时 `willEmit=false`，前端会静默漏段。

## 5. 组件与状态

```
frontend/app/session-overview/overview-timeline.tsx     // 渲染（行 + 轨道 + 刻度 + now 线 + hover）
frontend/app/session-overview/overview-timeline-model.ts // 纯函数：window 计算、排序、segments、刻度
```

- 状态：`overviewTimelineRangeAtom`（2h/8h/24h/7d，默认 8h，atomWithStorage，key `snorkeling.overview.timelineRange`）
- 复用：`OverviewViewModesImplemented` 加 `"timeline"`；header 分段切换器已经支持第 3 枚按钮，**不需要再改结构**
- 点击行为：点条 = 打开会话详情（与卡片一致）

## 6. 验证设计

- 单测：`buildTimelineSegments` 窗口裁剪 / 缺口补 unknown / 排序 / 空数据
- 真机（`scripts/verify/overview-timeline/`，新 area，照 `_template`）：
  - 行数 = agent 块数；每行至少 1 段；刻度数恒定；`now` 线只在窗口右端
  - 切 2h/24h 后刻度文案格式变化（小时 vs 日期）
  - 窄面板横向可滚且 snap 生效
  - 播种 agent 块（复用 overview-board 的做法）验证「尾巴颜色 = 当前状态色」

## 7. 风险

| 风险 | 处置 |
|---|---|
| 历史会话 `createdAt` 缺失 → 条长严重偏短 | tooltip 标 `start unknown`，并在行首加淡色问号 |
| 会话数很多时行数爆炸 | 默认只显示「最近 8h 有活动」的会话，其余折叠到「更早（n）」 |
| G2 写盘频率 | 只在 presented 状态变化时写，且 ring buffer 不整表重写（按 block 分 key 或 debounce 500ms） |

---

## 8. G3 · 按对话轮拆分（2026-11-25，原型阶段）

> 任务：`11-25-overview-turn-gantt`。原型：`design/prototypes/overview-dashboard/overview-board-v2/turn-gantt.html`。
> 目标：一眼看出「每一轮里模型想了多久、工具跑了多久、中间空了多久」。

### 8.1 段模型（四类段 + 完成点）

```
[空闲 18m]│≈思考 12s│工具 0.5s│≈思考 9s│工具 0.4s│…│回复生成 24s│▲完成 │空闲 2h10m│…
```

| 段 | 计算 | 精度 |
|---|---|---|
| `think` 思考 | `t(assistant+toolCall 条目) − t(上一条消息)` | **估算** |
| `tool` 工具执行 | `t(toolResult 条目) − t(assistant+toolCall 条目)` | 精确 |
| `reply` 回复生成 | `t(末条 assistant 文本条目) − t(最后 toolResult 条目)` | 精确（含思考） |
| `idle` 空闲 | `t(下轮 user 条目) − t(本轮末条)` | 精确 |
| `▲` 完成点 | `t(本轮末条)` | 精确 |

数据源：`ai_session_messages`（`role / text / timestamp / tool_name / thinking`）。**不需要新埋点**，
也不需要 §4 的环形历史 —— 这是会话文件里已经有的逐条时间戳。

### 8.2 为什么「思考」只能是估算（真机验证）

2026-11-25 用一个真实会话（192 条消息）实测相邻消息时间戳差：

| 转移 | 中位 | 结论 |
|---|---|---|
| `assistant+toolCall → toolResult` | **0.5s** | assistant 条目时间戳 = **生成完成/工具发起时刻** |
| `toolResult → assistant+toolCall` | **9.5~12.4s** | 模型侧耗时（思考 + 决策） |
| `user → assistant+toolCall` | 10.9s | 首段思考 |
| `assistant → user` | 135.5s | 真实空闲（等人） |

因此「上一条消息 → 下一条含工具调用的 assistant 条目」就是模型在思考+决定下一步的真实耗时，
但它是**模型往返**口径：混有网络/API 延迟、正文生成（该条目同时带 text 时无法剔除）。
`thinking` 只是 assistant 条目内的文本块，共享条目时间戳，**无法切出纯思考时长**（要秒级需上游写分块时间戳，不做）。

### 8.3 后端接口草案（下一包实现）

- 新增轻量批量读：SQLite 索引上 `WHERE session_key IN (…) AND timestamp >= windowStart` 一次扫描，
  Go 侧按轮归并成 `[{kind, fromMs, toMs}]` + 完成点数组，**RPC 不传任何文本**。
- 批 ≤20 会话；每会话封顶最近 200 轮；窗口裁剪在 SQL 里做。
- 段数封顶：每行输出 ≤60 段（超限合并最窄相邻段，合并段 kind=`merged`）；
  完成点 >30 抽稀；前端段 `min-width: 2px`。
- **不复用 `ReadTurns`**（`sessionread.go:333`，每页 ≤10 轮 + 每轮 3 次 SQL + 带文本，40 行会话 × N 页会爆炸）。

### 8.4 前端渲染（下一包实现）

- `OverviewTimelineRow` 增量加 `turnSegments?: TurnSegment[]`：有则整条替换 §4.5 的两段式，无则降级现状。
- 轻度缓存按 `sessionId + updatedAt`；只有会话更新才重取；只对可见行（`splitTimelineRows` 后 ≤40）取数。
- 渐进渲染：首帧 G2.1 粗条 → 段数据到达原地换段（DOM 结构不变，无布局抖动）。
- 条外框圆角 **4px**（固定）；内部段为铺排矩形不各自圆角，段间 1px 缝；条内不渲染文字，全部走 tooltip。

### 8.5 窗口口径（重要）

轮级细节只有细窗口可读：2h 窗口里 10s 思考段 ≈ 1.5px，是物理上限不是 bug。
原型因此提供 **30m** 档；正式实现建议在 2h 及以下显示轮级段，8h/24h 自动回退到 G2.1 粗条
（或按「每行 ≤60 段」封顶后仍显示，合并段用中性斜纹表示）。

### 8.6 验证设计

- 单测：`buildTurnSegments(turns)` 窗口裁剪 / 段数与完成点封顶 / 合并段计数 / 无索引降级。
- 真机（扩 `scripts/verify/overview-timeline`）：
  行数 = agent 块数；每行段 ≤60；完成点 ≤30；切 30m/2h 段数变化；stale 会话仍为两段式；
  首帧到段数据渲染 < 300ms（渐进，不阻塞）。
