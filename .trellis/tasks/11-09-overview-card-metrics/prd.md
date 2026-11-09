# Overview Agent Card 度量信息：消息数 / 体积 / 活跃跨度 / 创建时间

## Goal

Overview 的 agent 卡片（看板卡 `BoardCard` + 列表行 `BlockRow`）现在只有「标题 / 状态 chip / provider·项目·tag chips / preview / note / 3px mini timeline」，
完全看不到「这个会话多大多重、一共干了多久、什么时候开的」。缺的这四类信息**全部已经在内存里**（`SessionSummary` + 已产出的 timeline segments），
所以本任务只做呈现，不加 RPC、不改后端。

同时修掉一个已被真机暴露的可用性缺陷：卡头右上 `age`（`1d` / `26m`）**既无 `title` 也无 `aria-label`**，
用户第一次看到 `1d` 时无法判断它和状态 chip 的 `Working 12m`、新增的累计运行时长的区别。

设计原型（已评审通过）：`design/prototypes/overview-dashboard/agent-card-metrics/`（README 含三种变体实测卡高与口径）。

## 做什么

### R1 `SessionMetrics` 单组件

新增 `frontend/app/session-overview/session-metrics.tsx`，作为四个度量的**唯一渲染入口**，两处复用：

```tsx
<SessionMetrics
    surface="board" | "row"
    messageCount?: number
    size?: number
    createdAt?: number
    updatedAt?: number
    segments?: readonly OverviewTimelineSegment[]
/>
```

- 全部数据缺失时返回 `null`（整条轨道不渲染，不留一条空分割线）。
- 每个度量格固定 `data-metric="msg|size|runtime|created"`，并带 `title` + `aria-label`。

### R2 编码（与 aisessions 同源，禁止第二份阈值）

| 度量 | 呈现 | 来源 |
|---|---|---|
| 消息数 | 10×10 热力格（填充高度 = level×20%，透明度随档递增）+ 数字（≥10000 走 `12.3k`） | `heatLevel(v, MessageHeatThresholds)`，import 自 `aisessions/utils.ts` |
| 体积 | 10×10 热力格 + `formatFileSize`（去空格 `2.4MB`） | `heatLevel(v, SizeHeatThresholds)` + `@/util/fileformat` |
| 活跃跨度 | 24×4 档位条 + **`↔3d`** | `(updatedAt \| live ? now) − createdAt` |
| 创建时间 | 纯文本 `MM-DD`（跨年 `YY-MM-DD`），`tabular-nums` | `createdAt`；精确到秒只进 `title` |

- 档位条的填充 = 档位 × 20%（档位阈值 `[10m, 1h, 8h, 24h]` → 5 档），**不是比例条**：跨卡可比，且不会因为会话越老条越满而产生假信号。
- 色用中性 accent（**不得**借状态色，否则卡片上出现第二个"状态指示器"）。
- `↔` 前缀是硬要求：不标则与卡头 age（`1d`）和状态 chip（`Working 12m`）混淆（详见 R4）。

#### 为什么是「活跃跨度」而不是「Σ working 段」（2026-11-09 修正）

实现前核对数据源发现：`buildTimelineSegments()` 的 `history` 参数**没有任何调用方**（源码注释：「目前没有调用方传，留给后端 ring buffer 落地后接」），
当前每个会话只能得到两段 `[unknown(startedAt→activeSince), 当前态(activeSince→endedAt)]`。于是「Σ working 段」实际会：

- live `working` 卡：`Σ = now − activeSince`，**与状态 chip 的 `Working Xm` 是同一个数**（纯重复）；
- `done/idle/stale` 卡：没有 working 段 → `Σ = 0` → 整格永不渲染（历史卡占多数）；
- 窗口外的卡：`buildTimelineRows` 直接 `continue`，连 segments 都没有。

所以本任务改用 **活跃跨度**（全卡可得、诚实、与卡头 age 和 chip 语义正交）。
真正的「Σ 净运行时长」等 `design/plans/overview-board-timeline.md` §4 的状态历史 ring buffer 落地后再升级 —— 视觉结构不用改，只换数据源与文案。

### R3 落点

- **看板卡**：插在 `card.note` 之后、mini timeline 之前；轨道上方 1px hairline（`rgb(from var(--main-text-color) r g b / 0.08)`）。
- **列表行**：`BlockRow` 右侧（现 `MessageSquares` 区域附近）接入 `surface="row"`：无上分割线、gap 加大、数字不缩。
- 变体 A（度量轨）为最终形态；B/C 只在原型里留痕，不实现。

### R4 三个「多久」必须可分辨（不变量）

| 位置 | 例 | 语义 | 起点 |
|---|---|---|---|
| 卡头 age | `1d` | 多久没动静 | `updatedAt` → now |
| 状态 chip | `Working 12m` | 当前这一步/轮跑了多久 | `phaseSince ?? activeSince` → now |
| 度量轨 | `↔3d` | 从创建到最后一次活动跨了多久 | `createdAt` → `updatedAt`（live 到 now） |

- 卡头 `.session-overview-board-card-age` 补 `title` + `aria-label`：`最后活动：YYYY-MM-DD HH:mm:ss · 1 天前`；`age === "now"` 时文案为「刚刚」。

### R5 不换行 / 高度稳定

- 所有数值容器 `tabular-nums` + `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`。
- 220px 列宽（当前真实下限）、最坏数据（`12345` 条 / `1.2GB` / 跨年日期）下**度量轨不换行**，`scrollWidth <= clientWidth`。
- 有数据 / 无数据两种卡的高度差只允许来自被隐藏的那一格（不得出现空占位格）。

## 验收标准（可机器判定）

1. `node scripts/run-task.mjs test-frontend`（或既有前端单测命令）通过，且新增 `session-metrics` 单测覆盖：
   - 阈值边界：消息数 4/5/6、99/100/101、499/500/501；体积 99K/100K/101K
   - 缺数据组合：全缺 → `null`；只缺 `size`；只缺 `createdAt`
   - 活跃跨度档位边界：`9m/10m/11m`、`59m/60m`、`7h59m/8h`、`23h59m/24h`
   - live 会话用 `now − createdAt`；`createdAt=0` → 整格不渲染；`updatedAt < createdAt`（脏数据）→ 钳到 0
   - 日期：同年 `10-28`，跨年 `25-12-11`
   - 跨度文案必含 `↔`
2. `grep -c "MessageHeatThresholds" frontend/app/session-overview/session-metrics.tsx` 为 0（只能 import，不许复制阈值数组）。
3. CDP 像素验证（`node scripts/inspect-electron-ui.mjs style ".session-metric"`）：
   - 220px 列宽下 `.session-metrics` 的 `scrollWidth === clientWidth`
   - `.session-overview-board-card-age` 的 `title` 非空且匹配 `/最后活动：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/`
4. 台账：`docs/project/verify-ledger.md` 增加一行结论（area = overview board）。

## 不做

- 不做聚合卡（"某 agent 名下 N 个会话"）。
- 不做「Σ working 净运行时长」—— 依赖尚不存在的状态历史 ring buffer（独立后续任务）。
- 不做 B（2×2）/ C（内联）变体与「卡片密度」设置项。
- 不动 mini timeline 的既有行为，不动后端与 RPC。
