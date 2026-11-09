> 同步状态：◐ 部分落地（2026-11-09：组件 + 单测 + verify 断言已落地）
> 镜像源：frontend/app/session-overview/overview-board.tsx, frontend/app/session-overview/session-overview.tsx, frontend/app/view/aisessions/session-row.tsx, frontend/app/session-overview/overview-timeline-model.ts
> 最后同步：2026-11-09

（镜像源对应：`BoardCard` / `BlockRow` / `HeatCell` 与阈值来源 / segments 产出）

# Overview Agent Card · 度量信息（消息数 / 体积 / 活跃跨度 / 创建时间）

看板卡与列表行补充"这会话到底多大多重、活了多久、什么时候生的"四类度量，可视化词汇与 aisessions 列表项同源：
**热力格 + 档位条（形状编码）+ 纯文本日期**，阈值直接复用 `heatLevel` 那套，不新增第二份。

> 2026-11-09 口径修正：原设计的「Σ working 净运行时长」在真实数据下不成立（详见「为什么是活跃跨度」），
> 已改为「活跃跨度」。实现代码：`frontend/app/session-overview/session-metrics.tsx` + `session-metrics-view.ts`。

打开方式：直接浏览器打开 `index.html`（零依赖）。可切 **暗/亮主题**、**A/B/C 变体**、**220/280/340 列宽**。

## 口径假设（未拍板项，按推荐值先落；改起来便宜但要先说清）

1. **「会话数量」= 该会话的消息条数**（`SessionSummary.messageCount`）。**不是**"某 agent 名下 N 个会话"的聚合卡 —— 那种卡是另一个设计（聚合口径 + 展开列表）。
2. **「运行时长」= 活跃跨度**：`createdAt → updatedAt`（live 会话走到 now）。占比条按档位填充，读作"这卡活了多久量级"。
3. **落点 = 看板卡 + 列表行都上**，两处复用同一个 `<SessionMetrics>` 组件与同一份阈值表。

## 三种变体（卡高为 `index.html` 内探针实测，220px 列宽）

| 变体 | 形态 | 单卡高 | 相对今天 | 结论 |
|---|---|---|---|---|
| 今天 | 无度量轨 | 129.0 px | 基准 | — |
| **A 度量轨** | preview 下一条 4 格度量行（1px 分割线） | 150.0 px | **+21.0 px** | ✅ 推荐：图形编码保留、扫读顺序自然 |
| B 2×2 格 | 2×2 带边框度量格 + 标签 | 216.0 px | +87.0 px | ✋ 卡太高，一屏少 2~3 张卡 |
| C 内联底轨 | 数字串与 mini timeline 同行 | 136.0 px | +7.0 px | ✋ 最省，但长条看起来像"下划线"、数字堆成一团，可视化退化成文字 |

> 三个数字都来自 `getBoundingClientRect().height`（探针卡离屏，不参与版面），切变体/主题/列宽会重测。
> 截图存于 `verify-runs/proto-shots/`（gitignore，仅本机）。

## 编码规则

| 度量 | 编码 | 常量 / 函数（实现时 **import，不许抄**） | 缺数据 |
|---|---|---|---|
| 消息数 | 10×10 热力格（填充高度 20%×level，透明度同步递增）+ 数字（≥10000 走 `12.3k`） | `heatLevel(v, MessageHeatThresholds=[5,20,100,500])` | `0/undefined` → 该格不渲染 |
| 体积 | 10×10 热力格 + `formatFileSize`（去掉空格：`2.4MB`） | `heatLevel(v, SizeHeatThresholds=[100K,460K,2M,6M])` | `null/0` → 不渲染 |
| 活跃跨度 | 24×4 档位条（档位 × 20% 填充）+ **`↔3d`** | 档位阈值 `SpanHeatThresholds = [10m, 1h, 8h, 24h]` → 5 档 | `createdAt=0` → 不渲染 |
| 创建时间 | 纯文本 `MM-DD`，跨年 `YY-MM-DD`，`tabular-nums` | 精确到秒进 tooltip / `aria-label` | `0` → 不渲染 |

设计取舍：

- **形状优先，颜色只做第二通道**：热力格换档靠填充高度，暗色主题 5 档灰阶也分得开（同 aisessions `HeatCell` 的理由）。
- **占比条用中性 accent 色**，不借状态色 —— 否则卡片上出现第二个"状态指示器"，和 `AgentStatusChip` 打架。
- **`↔` 前缀是必需的，不是装饰**：见下面「三个多久」。
- **档位条不是比例条**：`span / (now − createdAt)` 对老会话恒接近满格、没有信息量；档位条跨卡可比，且与两个热力格共用「档位 × 20%」的形状词汇。
- **创建时间只给日期**：窄列里 `2026-10-28 09:12:33` 是噪声，精确值放 tooltip。
- **单行硬约束**：所有数值 `tabular-nums` + `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`，卡高不随数据跳动。

## 三个「多久」（最容易踩的坑，已修）

一张卡上能同时出现三个时长，前两个单位都是 `m`，不标注就会互相冒充（评审时用户第一反应就是「这个 1d 和那个 3m 有什么区别」）：

| 位置 | 例子 | 回答的问题 | 起点 | 刷新 |
|---|---|---|---|---|
| 卡头右上 age | `1d` | 多久没动静（新鲜度，决定要不要回头看） | `updatedAt` → now | 30s tick，跨档才变；**hover 出完整时间戳**（本次一并修：原本既无 `title` 也无 `aria-label`） |
| 状态 chip | `Working 12m` | 当前这一步/这一轮跑了多久 | `phaseSince ?? activeSince ?? updatedAt` → now | 1Hz 秒级跳动；done/idle 不显示 |
| 度量轨 span | **`↔3d`** | 从创建到最后一次活动跨了多久 | `createdAt` → `updatedAt`（live 到 now） | 随 summary 变化才重算，不秒跳 |

因此实现两条硬要求：

1. `span` 的值**必须**带 `↔` 前缀（符号单独成 `<span>` 以便降一级样式），tooltip 写成「活跃跨度 3d4h：2026-11-06 09:12:33 → 2026-11-09 08:05:12」（live 时终点写「现在」）。
2. 卡头 `age` **必须**带 `title` + `aria-label`（`最后活动：2026-11-08 15:22:41 · 1 天前`；`age === "now"` 时写「刚刚」）。

## 为什么是「活跃跨度」而不是「Σ working 段」

实现前核对数据源发现：`buildTimelineSegments()` 的 `history` 参数**没有任何调用方**（源码注释：「目前没有调用方传，
留给后端 ring buffer 落地后接」），每个会话只能得到两段 `[unknown(startedAt→activeSince), 当前态(activeSince→endedAt)]`。于是：

- live `working` 卡：`Σ = now − activeSince`，**与状态 chip 的 `Working Xm` 是同一个数**（纯重复）；
- `done/idle/stale` 卡：没有 working 段 → `Σ = 0` → 整格永不渲染（历史卡占多数）；
- 时间窗外的卡：`buildTimelineRows` 直接 `continue`，连 segments 都没有。

所以改用全卡可得、语义正交的**活跃跨度**。真正的「Σ 净运行时长」等状态历史 ring buffer
（`design/plans/overview-board-timeline.md` §4）落地后再升级 —— 视觉结构不变，只换数据源与文案。

## 数据契约（零新增 RPC、零后端改动）

Overview 面板已经在用 `getCachedSessionSummary()`，返回的整个 `SessionSummary` 里就带 `messageCount / size / createdAt / updatedAt`；
`buildTimelineSegments()` 已经在为卡底 mini timeline 产出带毫秒区间的 segments。所以只需在 `OverviewBoardCard` 上多带 4 个字段：

```ts
type OverviewBoardCard = {
    // …现有字段
    messageCount?: number;   // summary.messageCount
    size?: number;           // summary.size
    createdAt?: number;      // normalizeTimeMs(summary.createdAt) —— 归一化在调用方做
    live?: boolean;          // summary.live：活跃跨度的终点走到 now
};
```

活跃跨度是**派生值，不进 memo**：`(live ? now : updatedAt) − createdAt`。`now` 本来就是 `BoardCard` / `BlockRow`
的 prop，放进 `boardCards` memo 会让整个卡片数组每 30s tick 重建一次。

## 新增组件

```tsx
// frontend/app/session-overview/session-metrics.tsx（组件） + session-metrics-view.ts（纯函数，可单测）
<SessionMetrics
    surface="board" | "row"        // 两处视觉差异的唯一入口
    messageCount={number | undefined}
    size={number | undefined}
    createdAt={number | undefined} // 毫秒，调用方先归一化
    updatedAt={number | undefined}
    live={boolean | undefined}
    now={number}
/>
```

- 单一渲染入口 → 阈值/格式化/缺数据规则只存在一份；`BlockRow` 与 `BoardCard` 都调它。
- 每格固定 `data-metric="msg|size|runtime|created"` + `title` + `aria-label`，供单测与像素回归定位。
- 全缺 → 返回 `null`（整条轨道不渲染，避免留一条空分割线）。

## 落地清单（进 Trellis 任务后按此执行）

1. `OverviewBoardCard` 增 4 字段；`session-overview.tsx` 组装处从 `summary` 与 `segments` 填充。
2. 新建 `session-metrics.tsx` + 单测：
   - 阈值边界（4/5/6 条、99/100/101 条；99K/100K/101K）
   - 缺数据组合（全缺 → null；只缺 size；只缺 created）
   - 活跃跨度档位边界（9m/10m、59m/60m、7h59m/8h、23h59m/24h）与 live / 脏数据钳 0
   - 日期跨年格式（`25-12-11` vs `12-11`）
   - span 值必带 `↔`（防回退成裸 `3d`，否则与卡头 age 混淆）
3. `BoardCard` 插入度量轨（`card.preview` → `card.note` → 度量轨 → mini timeline）；`BlockRow` 右侧接入 `surface="row"`。
4. `BoardCard` 的 `.session-overview-board-card-age` 补 `title` + `aria-label`。
4. SCSS：`.session-metrics` / `.session-metric*` 一套（含暗/亮/单色主题三套 token 检查）。
5. 验证：`scripts/verify` 新增 area 或用现有 overview 验证台，断言 220px 下 `scrollHeight === clientHeight`（不换行）、卡高与"有数据/无数据"一致、`data-metrics-count` 与预期格数相等。

## 待拍板

- 口径三条（见上）若改，只影响数据组装与文案，不动视觉结构。
- B/C 是否保留为设置里的"卡片密度"选项？目前判断：不做，先把 A 上掉。
- 状态历史 ring buffer 落地后，第 3 格可从「活跃跨度」升级为「Σ 净运行 + 占比」，视觉不用改。

## 实现状态

- 2026-11-09：`frontend/app/session-overview/session-metrics{,-view}.tsx` + `session-overview.scss` 已落地（◐），
  单测 `session-metrics-view.test.ts`（25 例）+ 真机验证 `scripts/verify/overview-board`（metrics-* 断言）。
