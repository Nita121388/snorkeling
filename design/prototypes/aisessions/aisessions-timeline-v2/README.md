# Session Detail · 批注时间线 v2 — 时间桶分页 / UI 美化 / 外部 Agent 写入 — 原型

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：`frontend/app/view/aisessions/annotation-rail.tsx`, `frontend/app/view/aisessions/annotation-card.tsx`, `frontend/app/view/aisessions/annotation-model.ts`, `frontend/app/view/aisessions/annotation-store.ts`
> 最后同步：2026-11-11
> 设计文档：`design/plans/aisessions-annotation-timeline-v2.md`

## 目的

批注时间线 v2 的交互原型，对应设计文档的三块：

1. **时间桶分页（D1）**：批注按天聚桶；初始只加载最近 2 个桶，顶部「加载更早」前插（滚动锚定不跳）、日期跳转直达任意桶、「回到最新」浮动 pill；桶间隔 ≥2 天画「… 跳过 N 天 …」稀疏折叠。
2. **UI 美化（D2）**：消息流日期分段头（sticky：`今天 · N 条批注` + 密度微条）；rail 圆点三态不变 + **agent 角标**（右上 4px）；悬浮卡批注加类型图标 + 来源徽章三档（You / AI / 🤖 agent）。
3. **外部 Agent 写入（D3）**：「模拟外部写入」按钮演示 `wsh annotation add` 落库后的效果——agent 批注直接 accepted、卡内 `🤖 pi · HH:MM` 徽章、视口外新批注只出「N 条新批注 ↓」pill，不劫持滚动。

## 打开方式

```bash
open design/prototypes/aisessions/aisessions-timeline-v2/index.html
```

纯静态，无依赖、无构建。顶部 `Light/Dark` 切换对照明暗（配色 token 取自 `frontend/app/theme.scss` 暗色默认值）。

## 数据（固定 mock，与 smoke 测试联动）

5 个时间桶（11-11 今天 → 10-31），10 条批注（user / AI draft / agent 三种来源），桶间有 3 段稀疏间隔（跳过 3 / 2 / 2 天）。初始窗口 = 最近 2 桶。

| 桶 | 日期 | 消息 | 批注 |
|---|---|---|---|
| b0 | 今天 11-11 | seq 40–46 | note(user) · milestone(🤖 pi) · decision(user) |
| b1 | 昨天 11-10 | seq 30–38 | question(AI draft) · note(🤖 codex) |
| — | 跳过 3 天 | | |
| b2 | 11-06 | seq 22–26 | milestone(user) · note(user) |
| b3 | 11-03 | seq 16–20 | decision(user) |
| — | 跳过 2 天 | | |
| b4 | 10-31 | seq 8–14 | note(user) · question(user) |

## 交互对照

| 操作 | 行为 |
|---|---|
| hover 圆点 | 150ms 出卡（对齐真实 `HoverDelayMs`） |
| 单击圆点 | 钉住卡片 + 跳转对应消息 + 1200ms flash（对齐真实行为） |
| 「加载更早」 | 前插一个桶，**滚动位置不跳**（scrollHeight 补偿） |
| 日期跳转 ▾ | 列出全部桶；未加载的桶直接补齐窗口后滚到该桶头 |
| 「回到最新」 | 滚到底部（向上滚出 300px 才出现） |
| 模拟外部写入 | 落一条 `source=agent, author=pi` 的批注 → rail agent 角标 + 顶部「1 条新批注 ↓」pill |
| 点 pill | 加载并跳到新批注，计数清零（不自动跳） |

## 与真实组件的对齐点

- rail 结构 / 圆点三态 / playhead / 折叠 16px：镜像 `annotation-rail.tsx` 现状，只新增 agent 角标与桶刻度。
- 悬浮卡 320px / max-height 60vh / pinned 语义：镜像 `annotation-card.tsx`。
- 桶构建纯函数（`buildTimeBuckets`）的输入输出形态见设计文档 §3.2，落地时进 `annotation-model.ts`。

## 状态说明

- 本原型只做交互与视觉验证，**不含**真实 RPC / 游标 / 幂等逻辑，契约以设计文档 §5.2 为准。
- smoke 测试：`node design/prototypes/aisessions/aisessions-timeline-v2/smoke.test.cjs`
