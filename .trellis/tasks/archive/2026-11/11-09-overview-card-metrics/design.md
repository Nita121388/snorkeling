# 技术设计：Overview 卡片度量信息

## 边界

改动集中在 `frontend/app/session-overview/`，**不碰后端、不碰 RPC、不碰 aisessions 模块**（只 import 它的纯函数）。

## 数据流

```
SessionSummary (已有)
  messageCount / size / createdAt / updatedAt / live
        │
        ▼
session-overview.tsx: useMemo(boardCards)      ← 新增 3 字段（不含派生值）
        │
        ▼
OverviewBoardCard（overview-board-model.ts 类型）
        ├── overview-board.tsx  BoardCard    → <SessionMetrics surface="board" now={now} …/>
        └── session-overview.tsx BlockRow    → <SessionMetrics surface="row"  now={now} …/>
```

**活跃跨度是派生值，不进 memo**：`span = (live ? now : updatedAt) − createdAt`。
`now` 本来就已经是 `BoardCard` / `BlockRow` 的 prop（30s tick 驱动状态 chip），所以在组件里算不会有额外订阅；
放进 `boardCards` memo 反而会因为依赖 `now` 而让整个卡片数组每 30s 重建一次（`timelineRows` / `miniTimelines` 都会跟着重算）。

**不读 segments**（与 2026-11-09 的口径修正一致）：`buildTimelineSegments()` 的 `history` 参数当前无调用方，
`working` 段只有「当前态」一段且被时间窗裁剪，`Σ working` 会退化成 chip 的跑时或恒为 0/缺失。
详见 `prd.md` 的「为什么是活跃跨度而不是 Σ working 段」。

## 为什么是单组件

阈值（`MessageHeatThresholds` / `SizeHeatThresholds`）、格式化（`formatFileSize`）、缺数据规则、日期跨年规则，
一旦在 BoardCard 与 BlockRow 各写一份，下次改阈值必然漂移 —— 这个仓库在 chip 上已经吃过一次亏
（`agent-status-chip.tsx` 头部注释记录了 4 份实现漂移的历史）。所以：**一个文件、一个渲染入口、两个 surface 修饰符**。

## 关键取舍

1. **卡高 +21px（220px 列宽，探针实测 129.0 → 150.0）**：度量轨独占一行（padding-top 6 + 10px 内容 + gap 4），
   换来图形编码（热力格 / 占比条）不被压成文字。B（+87px）与 C（+7px）实测记录在原型 README，均否决。
   C 被否决的理由是**视觉语义**而非成本：数字串与 3px mini 条同行时，长条看起来像"下划线"，图形编码退化成文字。
2. **占比条用中性 accent**：借状态色会让卡片出现第二个"状态指示器"，与 `AgentStatusChip` 争抢注意力。
3. **创建时间只显示日期**：窄列 `2026-10-28 09:12:33` 是噪声；精确值进 `title`/`aria-label`。
4. **`↔` 前缀**：`Working 12m`（chip）= 当前轮跑时；`↔3d`（度量轨）= 从创建到最后活动的跨度；`1d`（卡头）= 距上次活动多久。三者语义正交，但字号/单位太像，不标必混。
5. **档位条而非比例条**：`span / (now−createdAt)` 这种比例对老会话恒接近 100%，没有信息量；改用档位（`[10m,1h,8h,24h]` → 5 档 × 20% 填充），跨卡可比且与两个热力格同一套档位机制。
5. **age 补 title**：`BoardCard` 的 age 是既有元素，本次只加无障碍/自解释，不改文案宽度（避免 220px 列宽下标题被挤）。

## 兼容与回滚

- 纯新增组件 + 两处插入 + 一个 `title` 属性；无 store / schema / RPC 变更。
- 回滚 = 删除两处 `<SessionMetrics>` 调用（组件文件留着不影响任何东西）。
- 无 feature flag：卡片已在高频使用，按本仓惯例不用开关（`OVERVIEW_BOARD_ENABLED` 这种全局开关只在换整体视图时用）。

## 风险

| 风险 | 处置 |
|---|---|
| 220px 列宽下 4 格挤爆（换行 → 卡高跳动） | 全部 `nowrap` + `text-overflow:ellipsis`；CDP 断言 `scrollWidth === clientWidth` |
| `↔` / `Σ` 这类符号字形在等宽/中文字体下偏宽 | 符号独立 `<span>`（10px + `margin-right:1px` + `opacity .75`）；若仍溢出，退化方案是把档位条从 24px 缩到 20px |
| `live` 会话的 `updatedAt` 落后于 `now`（最后一条消息时间） | `live === true` 时用 `now − createdAt`；否则用 `updatedAt − createdAt`，两者都钳到 `>= 0` |
| BlockRow 右侧现有 `MessageSquares` 占位冲突 | `surface="row"` 复用同组件；先只在行右端接入，不动 MessageSquares 的既有位置 |

## 测试策略

- 纯函数层：`heatLevel` 已有测试，本次补 `session-metrics` 的**数据整形纯函数**（放同目录 `session-metrics.ts` 内的
  非 JSX 部分：`buildSessionMetrics(data)` → `{msg?:{level,text}, size?:{level,text}, span?:{level,text,pct,title}, created?:{text,title}}`），
  React 层只做装配 → 与 `session-run-badge-view.ts` 同一套路（本仓无 @testing-library，DOM 断言只在必要处用 jsdom）。
- 视觉层：`scripts/verify` 的 overview area（或新建）在 220px 列宽下断言不换行 + `title` 存在。
