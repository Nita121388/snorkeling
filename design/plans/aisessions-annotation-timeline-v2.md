# 批注时间线 v2 — 时间桶分页 / UI 规格 / 外部 Agent 写入协议

> 状态：▲ 设计活跃（未实现）
> 镜像源：`frontend/app/view/aisessions/annotation-rail.tsx`、`annotation-card.tsx`、`annotation-editor.tsx`、`annotation-model.ts`、`annotation-store.ts`、`timeline-virtual.ts`、`pkg/service/aisessionsservice/`、`pkg/aisessions/`、`cmd/wsh/cmd/wshcmd-agent-card.go`、`cmd/wsh/cmd/wshcmd-mcp.go`
> 关联：`design/plans/agent-control-surface.md`、`.trellis/tasks/10-25-aisessions-annotation-timeline/`、`.trellis/tasks/11-01-agent-control-surface/`、`frontend/app/view/aisessions/session-timeline-sync.ts`
> 日期：2026-11-11 · 版本 v2（深版）
> 原型：`design/prototypes/aisessions/aisessions-timeline-v2/`

---

## 0. 为什么需要 v2

当前批注时间线（v1）只解决「人偶尔手写几条批注，在左侧看到、点回去」。三个事实把它推到上限：

1. **条目量级会变**：R3 上线后，agent 每会话写 5–30 条，批量会话叠加后单会话批注从个位数涨到几百条，`Annotations` 全量拉取 + 全量渲染不再成立。
2. **时间语义缺失**：rail 只有圆点与轴，用户不知道「这条是今天的还是上周的」，也无法「回看 11-06 那天到底标了什么」。
3. **写入者变成多方**：人 / AI 草稿 / 外部 agent 三方写入同一张表，没有来源区分、没有冲突规则、没有审计字段。

v2 的目标不是加功能，而是把这三件事补成**可实现的规格**：分页协议（第 3 章）、视觉与交互规格（第 4 章）、写入协议（第 5 章）。

## 1. 成功判据

| # | 判据 | 验证方式 |
|---|---|---|
| S1 | 10k 条批注的会话，打开详情首屏 RPC ≤ 1 页（≤100 条），rail 首帧 < 50ms | 埋点 + 真机会话 |
| S2 | 「加载更早」前插 100 条后，视口内容像素不动（scrollTop 补偿误差 ≤ 1px） | DOM 测试断言 scrollHeight 差 |
| S3 | 任意批注可在 ≤2 次交互内到达（日期跳转 / 键盘 j-k / 搜索） | 交互走查 |
| S4 | 外部 agent 写入在 3s 内出现在 rail，且**不**打断用户当前滚动位置 | 真机 + 双进程 |
| S5 | 外部通道无法修改/删除任何既有条目（含自己写的） | Go 单测（RPC 无该 op） |
| S6 | 所有视觉状态（空/加载/错误/草稿/孤儿/密集/折叠）都有成品 | 原型场景矩阵 + DOM 测试 |

## 2. 现状盘点（精确到函数）

| 层 | 位置 | 现状 | v2 动作 |
|---|---|---|---|
| RPC | `AISessionsService.Annotations` | 只收 `sessionKey/connection/anchors`，**全量返回** | 加游标与 limit，旧调用不带游标 = 最新页 |
| 表 | `ai_session_annotations` | `source` 仅 `user|ai`，无 author/idempotency | 增 `author`、`idempotency_key`（§5.3） |
| store | `annotation-store.ts` | 模块级全量缓存 + `inflight` 单飞 + `lastAnchors` 补拉 | 加 window/cursor/evict/invalidate（§3.4–3.6） |
| 纯函数 | `annotation-model.ts` | `buildRailItems` / `clusterRailItems` / `sortAnnotations` | 加 `buildTimeBuckets`（§3.2） |
| rail | `annotation-rail.tsx` | 圆点三态 + 时间分布 + 固定槽滚动 + playhead + 悬浮卡钉住 | 改行对齐 gutter（滚动同步）、类型色点、过滤弹层、端帽（§4） |
| 卡 | `annotation-card.tsx` | 节点原文 + 批注列表 + Jump/pinned | 加来源徽章/上下条导航/编辑入口 |
| 编辑器 | `annotation-editor.tsx` | kind/title/body/tags 保存删除 | 只接来源只读态（外部条目禁改） |
| 流 | `session-detail.tsx` / `timeline-virtual.ts` | 虚拟化（阈值 60）+ 行高估算 | 加桶分段头 + 前插锚定复用（§3.5） |
| ACS | `wshcmd-agent-card.go` / `wshcmd-mcp.go` | `agent card get/set` + MCP 门面 | 加 `annotation add/list/get` + 2 个 MCP tool |

## 3. D1 分页协议

### 3.1 领域模型

```
Session ── 1:N ── AnnotationEntry (seq, id, kind, status, source, author, ts)
                       └── 聚合 ──► TimeBucket (dateKey) ── 聚合 ──► Window
Window = { buckets[], oldestCursor, newestCursor, hasMoreOlder, hasMoreNewer, bytes }
Cursor = { beforeSeq, beforeId }   // 复合游标 = 排序键前缀
```

**不变量**

1. 排序键恒为 `(seq ASC, id ASC)`；游标是排序键的**严格前缀式**（`beforeSeq < seq OR (beforeSeq = seq AND beforeId < id)`），同一 seq 多条不会漏/重。
2. 桶是**派生**的，不落库：`dateKey = 本地时区 INRANGE(ts).toDateString()`，`ts` 取**锚点消息时间**（不是批注创建时间）——时间线的语义是「这段对话发生在哪天」，不是「我哪天写的批注」。
3. 游标只在**窗口重载**时变化，滚动不重取。
4. 窗口永远包含最新桶（除非显式历史模式）：「回到最新」不需要重新计算 latest。

### 3.2 桶构建（纯函数，进 `annotation-model.ts`）

```ts
export type TimeBucket = {
    dateKey: string;            // "2026-11-11"，本地时区
    label: string;              // 今天 / 昨天 / 11-06（今天/昨天按 now 计算，其余 MM-DD）
    items: AnnotationRailItem[]; // 复用 buildRailItems 产物，按 (seq,id)
    gapDaysBefore: number;      // 与本桶更早邻居之间被跳过的整天数（0 = 相邻）
    count: number;              // items 条数（= 圆点数 / 分段头计数）
};
buildTimeBuckets(
    items: AnnotationRailItem[],
    tsOf: (seq: number) => number | undefined,
    opts?: { now?: number; timeZone?: "local" }
): TimeBucket[]
```

- **日界线必须用本地日历构造**：`new Date(y, m, d).getTime()`，禁止 `ts - i * 86400000` 反推（DST 日会差 1 小时，导致某桶少/多一天）。
- 缺失 `ts` 的条目（seq 未命中消息）→ 归入 `dateKey = "unknown"` 桶，label = `未知时间`，排在最后；不静默丢弃。
- 空桶（无批注的日子）不生成，只记 `gapDaysBefore`；渲染层决定是否画「… 跳过 N 天 …」。
- 单条批注的会话：1 桶、`gapDaysBefore = 0`、rail 单点居中（沿用 v1 等比铺满）。

### 3.3 RPC 契约

```go
// Annotations lists annotations of one session, ordered by (seq, id).
// 游标为复合游标：返回严格早于 (beforeSeq, beforeId) 的 limit 条，倒序取回后正序返回。
Annotations(req{
    sessionKey   string
    connection   string   // 远端隔离，语义不变
    anchors      []AnnotationAnchorRequest // v1 保留：触发重锚定
    cursor       *AnnotationCursor // nil/零值 = 最新页
    limit        int      // 默认 100，夹取 [20, 500]
}) → { annotations []AnnotationView, hasMore bool, nextCursor *AnnotationCursor }
```

SQL（索引命中 `(session_key, seq)`）：

```sql
SELECT ... FROM ai_session_annotations
WHERE session_key = ?1
  AND (?2 = 0 OR seq < ?2 OR (seq = ?2 AND id < ?3))
ORDER BY seq DESC, id DESC
LIMIT ?4 + 1;   -- 多取 1 条判 hasMore，不回表 count
```

- 不做 `OFFSET`：深翻页 O(n)，且并发写入会漂移。
- `hasMore` 只表示「更早还有」，不表示最新端还有；最新端靠 §3.6 的失效机制处理。

### 3.6 游标失效矩阵（必须逐行实现 + 单测）

| 事件 | 游标失效 | 处理 | 前端可见结果 |
|---|---|---|---|
| 新批注落在最新桶（seq 最大） | 否 | 追加；若在视口外 → `pendingNew` | 「N 条新批注 ↓」pill，不跳转 |
| 新批注落在**已加载窗口内**的历史 seq | 否 | 按 (seq,id) 插入对应桶，重算该桶 count 与相邻 `gapDaysBefore` | rail 即时长出新圆点（不重排整条轴） |
| 删除窗口内唯一条目（桶变空） | 部分 | 移除桶；若该桶正在视口内 → 保持 scrollTop，不塌缩跳动 | 分段头消失但内容不位移 |
| AI 重新生成替换 drafts | **是** | 整窗 invalidate → 回到最新页 | 滚动位置重置到最新（有 toast 说明） |
| 锚点重锚定改变 `seq`（排序键变化） | **是** | 整窗 invalidate | 静默重载；若用户正在看某条 → 按 anchorKey 重新定位 |
| 会话文件被重写（消息数/内容变化） | **是** | 由 `session-timeline-sync` 的 version 变更事件触发 | 静默重载 + 保留锚点 |
| 切换筛选 / 过滤 kind | **是** | 新 query hash，重置最新页 | 列表回到最新 |
| 切换会话 / connection | **是** | 新 cache key（沿用 v1 cacheKey） | — |

> 判定口径：**「条目集合的排序键空间变了」= 失效**；「只是新增/删除尾部元素」= 不失效。

### 3.7 窗口驱逐（内存上界）

- 上限：`MaxBuckets = 5`、`MaxEntries = 2000`（先到者触发）。
- 驱逐对象：**距离当前视口最远**的桶，且**永不驱逐最新桶**（pill/回到最新依赖它）。
- 驱逐后 `hasMoreOlder` 语义 = 「窗口外仍有更早条目」，与「是否已到最早」分开记两个布尔：`atEarliest` 由 `hasMore` 与已加载最小 seq 共同决定。
- 「回到最新」不清空历史桶（用户可能又要往回），只在超过上限时按上面的规则驱逐。

### 3.8 与虚拟滚动 / 滚动锚定的协同

前插 N 行后补偿：

```
delta = scrollHeight_after - scrollHeight_before
scrollTop_after = scrollTop_before + delta
```

- 必须在**同一帧**内完成（`useLayoutEffect` / rAF 单调），否则先渲染再补偿会闪一帧空白 —— 与 `10-27-aisessions-virtual-row-stability` 同源，直接复用其锚定工具，不另造。
- 虚拟列表 `initialOffset` 重新按新 `scrollTop` 计算；`measureElement` 缓存保留（行 key 不变），避免重测抖动。
- 触发阈值：`scrollTop < 200px` 时预取下一页（预取失败不改变滚动，只静默重试 1 次）。

### 3.9 时间桶与 DST / 时区

- 桶按**系统本地时区**切；跨时区用户会看到桶边界随系统时区变（可接受，且与「昨天」的直觉一致）。
- 禁止缓存 dateKey→timestamp 映射跨 DST（3 月/11 月各有一天的偏移不是 24h）。
- 时间格式遵循 `11-02-datetime-format-config`：分段头用「相对日期 / 绝对日期」两档，不硬编码 `MM-DD`。

### 3.10 深链与恢复

- 打开详情时若 URL/状态带 `annotationId`（例如从批注 Block / 搜索点进来）→ 以该条为锚：向前向后各取一页（`cursor` 双向），一次性把该桶补齐再定位。
- 恢复 tab 时（`10-26-tab-startup-restore`）：只恢复「最新页」，不恢复历史窗口（旧游标可能已失效，静默降级比猜更安全）。

## 4. D2 视觉与交互规格

### 4.1 组件树

```
SessionDetail
├─ DetailHeader        （已有，v2 不动）
├─ Body
│  ├─ AnnotationRail   52 / 16px
│  │  ├─ RailHead      Notes+计数 · 折叠 · 工具行（✨AI / ⌗ 类型过滤弹出层） · 草稿条 · 新批注 pill
│  │  ├─ RailMore      轴顶端帽：↑N / 加载中 ··· / 失败 !（加载更早不占主界面行）
│  │  ├─ RailBody      轴 / 行对齐标记 / 轴 scrub（永不滚动）
│  │  └─ AnnotationCard（悬浮层，320px）
│  └─ FlowWrap
│     ├─ Flow          BucketSection(分段头 + 消息行) × N + GapRow
│     └─ Composer      （已有；rail 用 marginBottom 让位）
└─ AnnotationEditor     （Modal，已有 shell，v2 加来源只读）
```

### 4.2 尺寸 / 色彩 token

| 元素 | 规格 | 来源 |
|---|---|---|
| rail 展开 / 折叠 | 52 / 16px | v1 44px → 52px（给类型色环与日期微标留空间） |
| 圆点 | 8px **类型色实心核**（核内左上径向高光 `--pip-highlight`）+ 2px 底色隔断 + 柔光晕（kind 色 30%）/ 激活 12px + 强光晕；**禁止近黑核**（浅色主题会生硬） | 新增（v3.1） |
| 圆点类型色 | note `--secondary` / milestone `--accent` / decision `--warning` / question `--error`，直接作为核色而非仅环色 | 新增 |
| 草稿 / 孤儿 | 草稿：底色挖空 + kind 色内圈；孤儿：核色换 `--warning` | 新增 |
| 草稿 | 空心核，保留类型色环 | v1 空心环的升级 |
| 孤儿 | 核改 `--warning-color` | v1 |
| agent 角标 | 5px，`--agent-color`，外圈 1.5px 主底色 | v1 |
| 轴 | 2px，两端渐隐（`border-strong` 7%~93%） | 新增 |
| 桶刻度 / 首尾时间 | **不做**（v4 已移除）；日期结构由 flow 日分隔头承担 | 删除 |
| hover 光晕 | 24px 圆，`--surface-strong`，scale 0→1（140ms） | 新增 |
| 分段头 | sticky，实色 84% + 底部渐隐；相对日期 chip（今天/昨天 accent 微调） | 升级 |
| 密度微条 | 4×15px、圆角 2px、kind 色 | 升级 |
| 悬浮卡 | 320px（窄视口 70vw），`max-height 62vh`，实色 `--modalbg` | v1 |
| 编辑器 | 与 `11-02-modal-single-shell-refactor` 的 DialogShell 对齐 | 依赖 |
| 动效 | hover 出卡 150ms、关闭 320ms、flash 1200ms、前插无动画、圆点过渡 140ms | v1 + 新增 |

语义色补充：`--agent-color` 必须与 `--accent-color`（AI 生成）区分；暗色下 `rgb(104,176,255)`（6.9:1），亮色 `rgb(28,92,160)`（5.9:1），均满足 AA。

### 4.2b rail 布局：行对齐 gutter（v4 关键决策）

**结论：不做独立时间轴上的“按时间分布圆点”。** 无论线性时间还是分带，圆点都会浮在没有内容的位置上（空白轴上的一颗孤点），这正是“丑”的根因。

改为 **gutter 模式**（参考 VS Code SCM gutter / GitHub PR 行内批注 gutter）：

```
标记 y = 目标消息行的屏幕 y（居中于行首内容）   —— 滚动时 rAF 同步
滚动时：syncRailPositions() 批量重算，标记跟内容一起移动
不可见行（在视口外）→ 标记 hidden，不渲染在轴上
```
为什么这是对的：

- 标记与内容**空间一一对应**：一眼看出“这条批注说的是哪条消息”，不需要在图例上找对应。
- 标记数 = 可见行上的批注数，天然不溢出、不需要压缩间距/自适应 ring，也不会出滚动条。
- 日期结构交给右侧消息流的日分隔头（Linear / Slack 的日期分组语言），rail 不重复画刻度。
- 与现有虚拟滚动天然兼容：真实实现里 y 取 `virtualizer.getOffsetForIndex`，不读 DOM rect（与 `10-27-aisessions-virtual-row-stability` 同源）。

约束：

- rail 头部改为**绝对定位浮动工具条**（Notes+计数、✨、过滤、端帽、草稿条、新批注 pill），不占轴线高度；否则标记会整体下移一个头高。
- 相邻标记最小错开 `MarkerMinGap = 16px`（防止同一区域两行几乎重叠时圆点相撞）；正常行距 ≥28px 不触发。
- 两个标记指向同一行（多批注）→ 合成一个 cluster 标记（沿用 `clusterRailItems`），卡内展示全部。
- 滚动同步必须走 rAF 合并且只读一次 rect/行偏移（批量），否则长会话滚动会掉帧。
- 不接受“标记不跟随内容”的近似方案：错位比没有更糟。

参考资料（选型依据）：

| 参考 | 抄什么 |
|---|---|
| VS Code · Timeline 视图 / SCM gutter | 标记贴内容行；minimap 的“密度 + 视口”心智 |
| GitHub · PR 行内批注 gutter / Activity | 行对齐标记、极轻分隔、hover 出卡 |
| Linear · Activity | 按天分组、图标+单行摘要、次要信息 hover 才出 |
| Notion · 页面评论/历史 | 日期 sticky 小标 + 条目卡片 |
| Slack · 消息日分隔 | 最省空间的日期分组（已用于 flow 分段头） |
| Mantine / Ant Design / MUI / PrimeReact · Timeline | 组件结构（轴/节点/内容分离、active 态），仅作结构参照，不引入库 |

**rail 不滚动（硬约束）**：

- `RailBody { overflow: hidden }`，时间线本体不允许出现滚动条。
- 因为只渲染可见行上的标记，溢出根本不会发生；任何动态高度（resize / 字号）都要重跑 `syncRailPositions`，不能靠滚动兼容。
- 圆点数 > 120 时先聚合为簇（`clusterRailItems`），不允许靠“缩到看不见”蒙混。

**「加载更早」入口位置（主界面零占用）**：

- 入口是浮动工具条里的第三颗按钮（`↑N` 还有 N 桶 / `…` 加载中脉冲 / `!` 失败可重试），不占消息流任何一行。
- 不用顶部横幅/按钮：主界面面积优先给内容，分页是时间线自身的事，入口长在时间线上。
- 到最早 / 折叠态（16px）时隐藏。

### 4.2c 分页模式（显示全部 / 按日期 / 按用户会话 / 按时间段 / 按数量）

需求：有时只想看某一段内容，不希望滚动串到别的页面；不同会话形态适合不同的分页单位。

| 模式 | 页单位 | 页 id（必须稳定） | 适用 |
|---|---|---|---|
| `all` 显示全部 | 不分页：整窗口连续滚动（小数据量默认） | — | ≤500 条 |
| `day` 按日期 | 本地日历日（对齐 §3.2 桶） | `d:YYYY-MM-DD` | 回看跨天会话 |
| `turn` 按用户会话 | 一条 user 消息开启一轮，到下一个 user 前为止 | `t:<user msg seq>` | 按「问→答」轮次回看（最贴合对话语义） |
| `interval` 按时间段 | 固定小时窗口 `floor(ts / win)`，win ∈ {1,6,12,24}h | `i:<windowStartTs>` | 单日超长、按天看粒太碎 |
| `count` 按数量 | 固定 N 条，N ∈ {20,50,100}，**从最新端往前切块** | `c:<页首条 seq>` | 均匀流水式阅读 |

### 4.2c-1 入口位置（真实 UI）

原型顶栏的控件属于**审阅壳**，不是产品界面。真实入口分四层：

| 层级 | 位置 | 行为 |
|---|---|---|
| 主入口 | **会话详情头右侧**（`⋯` 左边）的视图 chip：`全部` / `按日` / `N 轮` / `6h` / `20 条` | 常驻可发现；点开分页方式弹层，chip 文案随模式变化 |
| 上下文入口 | **翻页条文字本身**（`今天 · 11-11 · 2/2`） | 已处于分页态时就地改模式，不用回顶部找 |
| 默认值 | 设置 → AI 会话 → 「默认分页方式」：自动 / 全部 / 按日 / 按用户会话 / 时间段 / 数量 | 新会话初值；`自动` = ≤500 条全部，>500 按日 |
| 覆盖与持久化 | 每个 tab 的会话详情记住自己的选择（connection+sessionKey） | 切 tab / 重开不丢；菜单内「跟随默认」重置（对齐 `10-29-aisessions-filter-state-persist`） |

**明确不放**：rail 工具条（52px 塞不下带文字的菜单，只留 ✨ / 过滤 / 端帽）、详情头常驻分段控件（长期占主界面一条）。

**默认规则（autoPageMode）**：会话总消息 ≤ 500 → `all`；> 500 → `day`。用户手动选过（`pageModeUserSet`）后同一会话内不再被默认规则覆盖；真实实现随 tab 状态持久化（对齐 `10-29-aisessions-filter-state-persist`）。

**不变量 / 边界**：

- 分页只在**前端渲染层**切页；数据加载仍按 §3.3 游标分页，两者不是一回事。
- **页 id 稳定**：day/interval 由时间键决定；turn 由 user 消息 seq 决定（`t:<user seq>`）；count 尾锚定，prepend 更早内容只在前面新增页，当前页成员不变。
- **翻到最旧页再往前** → 先加载一页数据（游标），仍停留在当前页；count/interval 可能一次加载不足以长出新页，需连按（已知取舍，写进 tooltip）。
- **跳转自动切页**：日期跳转 / 新批注 pill / 卡片 Jump 到不在当前页的消息 → 先切到包含它的页再定位。
- **作用域收窄**：非 all 模式下 rail 标记、悬浮卡、kind 过滤计数、草稿条、读数全部只反映当前页（`scopeSeqs()` 返回当前页 seq 集合）。
- **端帽（`↑N`）只在 all 模式出现**；分页模式的加载语义由翻页条承担（翻到最旧页自动补数据）。
- **方向**：`←` / `‹` = 更早，`→` / `›` = 更新。
- **不做**：页码输入框、按批注数分页、混合模式（一天 + 上限条数）、all 模式下隐藏分页入口。

落地位置：`session-detail.tsx` 增 `pageMode / intervalHours / countSize / lockPageId` 状态与 `computePages()/scopeSeqs()` 纯函数（可单测）；分页方式弹层与翻页条是轻量浮层组件，不走 DialogShell。

### 4.2d Node（时间线节点）

**定位**：Node 不是「一条批注内容」，而是时间线上的**关键位置标记**——可以不写正文，只说“这里很重要”。与四种批注类型同表共存（`kind='node'`），因此天然继承锚点、来源、草稿、导出等全部能力。

| 维度 | 规格 |
|---|---|
| 语义 | 关键位置点；`title` 可空、`body` 可空（卡片只显示「节点」） |
| 创建 | 消息 hover 出 `◇` 快捷钮（幂等：已存在则跳转查看）；也可在编辑器把 kind 改成 Node |
| 视觉 | rail 标记 = **菱形**（`rotate(45deg)`，`--kind-node` 中性色），与四种圆形批注区分；形状区分只在 rail 圆点 + 过滤弹层——密度微条是竖条不旋菱形，node 与 note 在那里只差灰阶（secondary vs tertiary） |
| 卡片 | 标题回退为「节点」；无正文时不渲染空 body 块（不留下“空白的批注”） |
| 过滤 | 类型过滤新增 Node 行（共 5 类） |
| 不做 | 自动结构节点（turn / tool / subagent 派生标记）：会和批注标记争夺视觉带宽，需要单独的开关与密度策略，另议 |

### 4.3 rail 状态矩阵

| 状态 | 触发 | 渲染 |
|---|---|---|
| empty  | 0 条批注 | 淡轴 + 「✨ 生成时间线」入口 + 竖排 “No annotations” |
| loading | 首次加载 | 轴 + 3 个 8px 灰点骨架（不闪） |
| error  | 加载失败 | 轴 + `!` 圆点 + hover 显示「重试」 |
| loaded | ≥1 条 | 行对齐标记（随滚动同步） |
| dense  | 同桶内圆点间距 < 28px | 固定 28px 槽 + rail 内部滚动（v1 逻辑） |
| drafts | 存在 `status=draft` | 头部草稿条：`✎ N` + 丢弃/全部采纳两个图标按钮 |
| orphan | 存在 `orphaned=true` | 该点为 warning 色 + 卡内黄条「重新指定 / 删除」 |
| collapsed | 用户折叠 | 16px 轴；若有未读新批注 → 轴上 1 个 4px 亮点 |

### 4.4 键盘模型（可访问性）

| 键 | 上下文 | 行为 |
|---|---|---|
| Tab | 页面 | 进入 rail → 焦点落在**当前 active 或第一个**圆点（roving tabindex） |
| ↑ / ↓ | rail 圆点 | 上一条 / 下一条批注（同时更新 active + playhead，不自动跳转） |
| Home / End | rail | 最早 / 最新一条批注 |
| Enter / Space | rail 圆点 | 钉住卡片 + 跳转 + flash |
| ← / → | 卡片打开时 | 上一条 / 下一条批注（卡片内容切换，不移动焦点） |
| e | 卡片 | 打开编辑器（外部来源条目 → 只读，禁用） |
| Esc | 卡片 / 编辑器 / 下拉 | 关闭最上层 |
| ⌥/Alt + ↑↓ | flow | 按批注跳跃（等同 rail 上下条） |

ARIA 契约：

- rail 容器 `role="navigation" aria-label="批注时间线"`；
- 圆点 `role="button"`，`aria-label="#41 · 3 条批注 · 10:02"`，激活点 `aria-current="true"`；
- 卡片 `role="dialog" aria-modal="false" aria-label="节点 #41 的批注"`；
- 新批注 pill `role="status" aria-live="polite"`（读屏播报一次，不重复）；
- 分段头 `aria-hidden="true"`（纯视觉分隔，不进阅读顺序）；
- 焦点可见：`:focus-visible` 2px `--focus-ring-color`，与 `web-design-guidelines` 一致。

### 4.5 悬浮卡内容层级（信息密度）

```
[类型图标] #41 · 10:02            [Jump] [✕]
────────────────────────────────────────
节点原文（≤120 字，尾部渐隐，可 Edit）
────────────────────────────────────────
[kind 图标] 标题                    [来源徽章]
正文（3 行截断）
#tag #tag
────────────────────────────────────────
[‹ 上一条] [下一条 ›]  （同节点多条时出现）
```

来源徽章三档：`You`（中性灰）/ `✨ AI`（accent，含「草稿」小字）/ `🤖 pi · 10:31`（agent 色，title 为 `via wsh annotation add`）。

### 4.6 明确不做

- 不加第三栏（批注列表页）——`10-25-aisessions-annotation-export` 的批注 Block 承担；
- 不做横向时间轴 / 日历热力图；
- 不做滚动反向高亮（父任务 PRD 已定单向耦合）；
- 不在 rail 内塞完整日期文字：只在带边界放 8px 日期微标 + 轴首/尾 `HH:MM`，其余靠 hover tooltip（52px 宽只容得下微标）。

## 5. D3 外部写入协议

### 5.1 通道与权责

| 通道 | 调用方 | 鉴权 | 实现 |
|---|---|---|---|
| `wsh annotation ...` | Block 内本地 agent | 既有 wsh 权限（同 `agent card`） | 本批 |
| MCP tool | App 外 agent | ACS P1.5 scoped token（topic 白名单） | B3 |
| 前端 UI | 人 | 会话内 | v1 已有 |

三方共用**唯一写路径**：`agentdata.ApplyPatch`（备份 + 审计 + 前置条件），禁止第二套 SQL 直写。

### 5.2 CLI 规格

```
wsh annotation add --session <sessionKey|current> --anchor <seq:12|ItemKey>
                   --kind note|milestone|decision|question|node
                   --title <text> [--body <text> | --body-file -]
                   [--tag <t>]... [--author <agent>]
                   [--idempotency-key <k>] [--json]

wsh annotation list --session <sessionKey|current> [--kind <k>] [--limit 100]
                    [--before seq:12] [--json]

wsh annotation get <id> [--json]
```

示例：

```bash
# agent 写完测试后记一条里程碑（幂等键防重试重复）
wsh annotation add --session current --anchor seq:44 --kind milestone \
  --title "解析修复完成" --body "12 个回归用例全绿" --tag done \
  --author pi --idempotency-key "$(uuidgen)" --json

# 看当前会话最近 20 条
wsh annotation list --session current --limit 20
```

退出码：`0` 成功（含幂等重放）/ `1` 用法错误 / `2` 会话或锚点不存在 / `3` 限流 / `4` scope 拒绝。

### 5.3 RPC 与表结构

```go
AnnotationAppend(req{
    sessionKey, connection?,
    AnchorKey       string // ItemKey 或 seq:N
    Kind            string
    Title, Body     string
    Tags            []string
    Author          string // 必填，进审计
    IdempotencyKey  string // 可选
}) → { AnnotationView, Deduplicated bool, AnchorResolved bool }
```

```sql
-- ensureAnnotationColumns 风格 ALTER
ALTER TABLE ai_session_annotations ADD COLUMN author TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_session_annotations ADD COLUMN idempotency_key TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ann_idem
  ON ai_session_annotations(session_key, idempotency_key)
  WHERE idempotency_key <> '';
```

### 5.4 不变量（全部单测锁定）

1. **append-only**：`AnnotationAppend` 无更新/删除分支；对既有 id 的任何修改尝试在 RPC 层就不存在。
2. 外部写入直接 `status=accepted`、`source=agent`、`author=<name>`；不进入 AI 重新生成的替换集（替换集只看 `status=draft OR (source=ai AND user_edited=0)`）。
3. 幂等：`(session_key, idempotency_key)` 唯一；命中返回原条目 + `deduplicated=true`，`created_at` 不变。
4. `user_edited=1` 的条目对任何通道不可变（v1 不变量保持）。
5. 写入必须带 `Author`；空 author 直接拒绝（`E_AUTHOR_REQUIRED`），避免无法审计的匿名写入。

### 5.5 实时会话的顺序保证

问题：live 会话的消息可能还没落 SQLite，`seq` 由 agent 从 `wsh session live` 取得，或直接给 `ItemKey`。

- `AnchorResolved=false` 时仍保存（`anchor_preview` 写空、`seq` 由请求给出），前端在消息出现后走 v1 重锚定补齐。
- 排序仍用 `(seq, id)`；pending 条目若 `seq` 与后端解析不一致，**以请求 seq 为初始值**，重锚定后更新并 invalidate 窗口。
- 不允许 agent 传 `seq` 之外的顺序暗示（如「插到第 3 条」）——排序只有一条规则。

### 5.6 权限与 scope 语法（B3）

```
scope = "annotation:append:session:<sessionKey>"        // 单会话
      | "annotation:append:project:<projectPathPrefix>" // 项目前缀（前缀匹配）
      | "annotation:read:session:<sessionKey>"
```

- 写入 sessionKey 必须被某条 scope 覆盖；`annotation:append:project:` 前缀匹配按路径分隔符归一（`C:\a\b` 与 `C:/a/b` 视为同一）。
- token 不含写 scope → `E_SCOPE_DENIED`，CLI 退出码 4。
- 不做通配 `*`：批注写入是内容生产，最小权限。

### 5.7 速率限制（防失控）

| 维度 | 上限 | 超限行为 |
|---|---|---|
| 单会话 24h | 200 条 | `E_RATE_LIMITED`，错误信息带 `retryAfter` |
| 单会话每秒 | 5 条 | 同上（瞬时保护） |
| 单 token 每小时 | 1000 条 | 同上 |

- 超限**不静默丢弃**：返回明确错误码 + 提示「合并成一条再写」。
- 限流计数放内存（进程级），不落库；重启清零可接受（设计取舍：避免为限流加表）。

### 5.8 审计事件字段

```json
{
  "event": "annotation.append",
  "sessionKey": "…", "annotationId": 123,
  "author": "pi", "tokenId": "tok_…", "idempotencyKey": "…",
  "anchorKey": "seq:44", "anchorResolved": true,
  "deduplicated": false, "at": 1762…,
  "source": "wsh | mcp | ui"
}
```

- 进 AI Audit（`10-27-aiaudit-ui-overhaul`）的 `agent-writes` 分类；时间线里只显示徽章，不展开审计。

### 5.9 错误码表

| code | 触发 | CLI 退出码 | 建议 |
|---|---|---|---|
| `E_SESSION_NOT_FOUND` | sessionKey 未索引 | 2 | 先打开一次会话触发扫描 |
| `E_ANCHOR_NOT_FOUND` | 锚点不在会话中且不允许 pending | 2 | 用 `wsh session live` 取真实 seq |
| `E_EARLIER` | —（保留） | — | — |
| `E_IDEMPOTENT_REPLAY` | 幂等命中（非错误） | 0 | 输出 `deduplicated=true` |
| `E_RATE_LIMITED` | 超 §5.7 | 3 | 合并写入 |
| `E_SCOPE_DENIED` | token scope 不足 | 4 | 重新签发 token |
| `E_AUTHOR_REQUIRED` | 缺 author | 1 | 补 `--author` |
| `E_KIND_INVALID` | kind 不在枚举 | 1 | 枚举见 §4.5 |

## 6. 落地批次与文件级改动

### B1 前端分页 + 视觉（无后端依赖）

| 文件 | 改动 |
|---|---|
| `annotation-model.ts` | `buildTimeBuckets`、`bucketOf`、kind 元数据（图标/顺序） |
| `annotation-model.test.ts` | 桶边界/DST/缺失 ts/空桶/单条/多条目同 seq |
| `annotation-store.ts` | window/cursor/evict/invalidate（§3.6–3.7），保留 v1 全量接口做兼容 |
| `annotation-store.test.ts` | 失效矩阵逐行、驱逐、并发（inflight + 迟到响应丢弃） |
| `annotation-rail.tsx` | 行对齐 gutter（滚动同步）、类型色实心核、浮动工具条、过滤弹层、端帽、键盘、轴 scrub + tooltip、草稿条、折叠未读 |
| `annotation-rail.dom.test.tsx` | 状态矩阵 8 态 + 键盘 roving focus |
| `annotation-card.tsx` | 来源徽章、上下条导航、编辑入口（外部条目禁用） |
| `annotation-card.dom.test.tsx` | 徽章三档、导航边界（首条无上一条） |
| `session-detail.tsx` | 分段头挂载 + 前插锚定（复用 v1 工具） |
| `timeline-virtual.ts` | `seqToTimestamp` 暴露给桶构建（无行为变更） |
| `pkg/service/aisessionsservice` | `Annotations` 加 cursor/limit（B1 唯一后端改动） |

### B2 写入通道

| 文件 | 改动 |
|---|---|
| `pkg/aisessions/annotations.go`（新） | `AppendAnnotation`、`ListAnnotationsPaged`、限流、幂等、author 校验 |
| `pkg/aisessions/sqlite_index.go` | 增列 + 唯一索引（`ensureAnnotationColumns`） |
| `pkg/aisessions/annotations_test.go`（新） | 不变量 5 条 + 限流 + 幂等 |
| `pkg/wshrpc/wshrpctypes.go` | `AnnotationAppendRequest/Result`、`AnnotationListRequest` |
| `pkg/service/aisessionsservice` | RPC 转发 |
| `cmd/wsh/cmd/wshcmd-annotation.go`（新） | add/list/get + 退出码 |
| `cmd/wsh/cmd/wshcmd-annotation_test.go`（新） | flag 校验/退出码/JSON 输出 |
| 前端 | agent 徽章、新批注 pill 接线（若 B1 已留桩只改数据源） |

### B3 MCP + token

| 文件 | 改动 |
|---|---|
| `cmd/wsh/cmd/wshcmd-mcp.go` | `annotation_append` / `annotation_list` tool |
| ACS token 校验 | session/project scope 匹配（§5.6） |
| `docs/project/agent-control-surface.md` | 新增章节 + 验收剧本 |

## 7. 测试矩阵

| 层 | 命令 | 覆盖 |
|---|---|---|
| 纯函数 | `npx vitest run frontend/app/view/aisessions/annotation-model.test.ts` | 桶构建全边界 |
| store | `npx vitest run frontend/app/view/aisessions/annotation-store.test.ts` | 失效矩阵/驱逐/并发 |
| DOM | `npx vitest run frontend/app/view/aisessions/*.dom.test.tsx` | 8 态 + 键盘 + 徽章 |
| Go | `go test ./pkg/aisessions -run Annotation` | 不变量/限流/幂等 |
| CLI | `go test ./cmd/wsh/cmd -run Annotation` | 退出码/参数 |
| 原型 | `node design/prototypes/aisessions/aisessions-timeline-v2/smoke.test.cjs` | 场景矩阵 |
| 真机 | `node scripts/verify/index.mjs --area aisessions-timeline` | 三面一致 + 双进程写入 |

**性能预算**：首次 RPC ≤ 100 条；rail DOM ≤ 120 节点；新增一条批注的派生计算 ≤ 2ms（只重算受影响桶）；滚动 60fps（rAF 合并、无 layout thrash）；窗口内存 ≤ 2000 条。

**测量方法**：真机 `performance.mark/measure` 包住 `renderRail`，连续 100 次新增批注取 P95；滚动用 `requestAnimationFrame` 采样掉帧率。

## 8. 风险 / 回滚 / 不做

- **回滚**：游标参数可缺省 → 旧前端行为等价；`author` / `idempotency_key` 有默认值 → 旧库直接 ALTER；B2 可单独 revert（UI 徽章降级为 `You`）。
- **风险：外部写入洪泛** → §5.7 限流 + §5.4 幂等；错误可见不静默。
- **风险：桶边界随系统时区跳变** → 接受（与「昨天」直觉一致），在文档与 tooltip 中显示绝对日期，减少歧义。
- **不做**：批注同步/分享、跨会话批量写、自动触发 AI 生成、rail 日历热力图、字符区间批注（属 `10-19-aisessions-annotate`）。
