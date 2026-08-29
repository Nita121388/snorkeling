# Agent 开篇 · Agent ID Card — UI 原型

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/term/term.tsx, frontend/app/agent-status/agent-status-derive.ts, frontend/app/session-overview/session-overview.tsx, frontend/app/view/aisessions/controls.tsx
> 最后同步：2026-08-26

## 目的

新建 / resume 一个 Agent 时，终端 block 先亮出一张「身份证」样式的开篇卡，集中展示该 agent 的基本信息（标题、状态、最新输出、备注、历史会话、sessionId）；跑起来后自动折叠成 header 小徽标，随时可展开。只借证件的**视觉语法**（横版比例、左照片区 + 右信息行、抬头条、波纹底纹、底部编号行、可选印章），不借证件字段。

## 解决的问题

1. **Agent 启动瞬间是空的**：终端还没输出时 block 一片空白，「开篇卡」把这个窗口期变成仪式感 + 信息密度。
2. **状态散落各处**：状态在 WidgetsBar、备注在 Sessions 视图、sessionId 要翻 meta——卡片把一个 agent 的"身份"聚合一处。
3. **折叠后不留入口**：折叠成 header 徽标（状态灯 + 标题）后，点击即回到全卡。

## 字段 → 数据来源（全部现成，零新后端）

| 卡面元素 | 数据来源 |
|---|---|
| 照片位 logo | `getAgentLogoByProvider(provider)`（真实 SVG 取自 `controls.tsx`），外圈 = 状态环 |
| Title | `SessionSummary.title`（getCachedSessionSummary） |
| Status | `presentAgentStatus()` label —— 文案逐字复用 derive.ts（Working · Tool: x / Thinking / Blocked / Done / Idle / Stale / Rate limited / No data） |
| Output 最新输出 | P0：scrollback 尾部一行；P1：SessionDetail 最后一条 message snippet |
| Note 备注 | `SessionSummary.note + tags`，点击进现有 note 编辑入口 |
| Sessions 行 | aisessions 按 `projectPath + source` 过滤的计数 + 最近活跃，点击跳 Sessions 视图带过滤 |
| 底部编号行 | `resolveAgentSessionId(meta)` 的 sessionId 等宽展示 + 复制 |
| 印章（可关） | state → 章颜色/文案：working=蓝、blocked/error/rate-limited=红、done=绿、stale/idle=灰；跳变时盖章动画 |

## 场景清单（10 个，scenario bar 切换）

working·tool / working·thinking / blocked / error / rate-limited / done / idle / stale，以及两个兜底：

- **unbound 待落户**：对应 `new-codex-session-unbound`（新建 codex 未绑定 session）——照片位「?」、Title 占位 untitled、Note 显示引导语、虚线章 PENDING。
- **missing 户籍注销**：对应 `SessionSummary.missing:true`——全卡置灰、章 MISSING、交互禁用。

## 生命周期（"出生即开篇"）

launch/resume → 展示开篇卡（终端尚无输出）→ 首屏输出/点击终端 → 自动折叠为 header 徽标① → 随时点②或徽标展开。原型用右上角 Toggle 按钮模拟。

## 分期

- **P0**：静态正面卡 + 状态环/章 + 复制 sessionId（纯前端拼装现成数据）。
- **P1**：Output 接 scrollback 尾行；Note/Sessions 点击接现有入口；unbound/missing 兜底。
- **P2（可选）**：盖章动画打磨、导出 PNG 分享卡。

## 已明确砍掉（brainstorm 结论）

- 性别/民族/出生/住址等证件字段硬隐喻 ❌
- 双面翻面卡 ❌（单面放得下）；QR 码 ❌（复制按钮够用）
- 风格致敬而非复刻真实居民身份证：版式自创、波纹底纹扣潜水主题，避免观感像证件伪造
