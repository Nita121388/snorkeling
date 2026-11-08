# Agent 开篇 · Agent ID Card — UI 原型

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/term/term.tsx, frontend/app/agent-status/agent-status-derive.ts, frontend/app/session-overview/session-overview.tsx, frontend/app/view/aisessions/controls.tsx
> 最后同步：2026-08-26

## 目的

新建 / resume 一个 Agent 时，终端 block 先亮出一张开篇卡，集中展示该 agent 的基本信息（标题、状态、最新输出、Note、Tags、会话方块、时间条、sessionId）；跑起来后自动折叠成 header 小徽标，随时可展开。版式自律：左照片区（provider logo + 状态环）+ 右信息行，底部编号行，不使用模拟印章，头部不放品牌条（🤿 Snorkeling），让信息密度前置。卡片背景为现代扁平渐变，去除证件式波浪底纹；支持本软件三种主题（light / dark / monochrome）切换预览。

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
| Note 备注 | `SessionSummary.note`，点击进现有 note 编辑入口 |
| Tags 标签 | `SessionSummary.tags`，与 Note 拆分独立成行 |
| 会话方块 | `SessionSummary` 历史会话列表 → 每个会话一个小方块（provider 色，live 高亮），hover 提示 |
| Sessions 行 | aisessions 按 `projectPath + source` 过滤的计数 + 最近活跃，点击跳 Sessions 视图带过滤 |
| 时间条 | 由 `SessionSummary` 运行轨迹派生的色块进度条：run / resumed / error / blocked / idle / done 分段 + 图例（各段累计时长）+ 总时间；原型中 `timeline` 数据模拟 |
| 底部编号行 | `resolveAgentSessionId(meta)` 的 sessionId 等宽展示 + 复制 |

## 场景清单（10 个，scenario bar 切换）

working·tool / working·thinking / blocked / error / rate-limited / done / idle / stale，以及两个兜底：

- **unbound 待落户**：对应 `new-codex-session-unbound`（新建 codex 未绑定 session）——照片位「?」、Title 占位 untitled、Note 显示引导语、无会话方块/时间条。
- **missing 户籍注销**：对应 `SessionSummary.missing:true`——全卡置灰、无会话方块/时间条、交互禁用。

顶部额外控件：**主题切换**（Light / Dark / Monochrome，对齐 `AppThemeMode`）、深色桌面对照、抄写开关。

## 生命周期（"出生即开篇"）

launch/resume → 展示开篇卡（终端尚无输出）→ 首屏输出/点击终端 → 自动折叠为 header 徽标① → 随时点②或徽标展开。原型用右上角 Toggle 按钮模拟。

## 分期

- **P0**：静态正面卡 + 状态环 + 复制 sessionId（纯前端拼装现成数据）。
- **P1**：Output 接 scrollback 尾行；Note/Tags/Sessions 点击接现有入口；时间条接真实运行轨迹数据；unbound/missing 兜底。
- **P2（可选）**：导出 PNG 分享卡。

## 已明确砍掉（brainstorm 结论）

- 合影章 ❌（证伪感强，去掉）；品牌条 ❌（信息密度前置）
- 性别/民族/出生/住址等证件字段硬隐喻 ❌
- 双面翻面卡 ❌（单面放得下）；QR 码 ❌（复制按钮够用）
- 证件式波浪底纹 ❌（改现代扁平渐变，融入 App 三主题）
