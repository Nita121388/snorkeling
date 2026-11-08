# 会话列表分组原型（参考 Lyra）

> 同步状态：▲ 设计活跃（待确认是否仍作为现行参考）
> 镜像源：（待补充；本原型字段对齐 `SessionSummary`）
> 最后同步：2026-11-08（从 `design/prototypes/` 根迁入并补 README）
> 迁移说明：原 `design/prototypes/index.html` + 根 `README.md`。

静态原型，直接在浏览器打开 `index.html`（无需构建）。

三种模式，顶部切换对比：

- **A · 项目分组**（推荐）：按 `projectPath` 分组，组头可折叠（状态记住），组间按“组内最近会话时间”排序，组内按时间排，跨 source 混排，无项目者归入底部「其他」。每组默认显示 5 条 +「展开更多」。
- **B · 时间带**：平铺列表按日历天分带：今天 / 昨天 / 过去 7 天 / 过去 30 天 / 更早。
- **现状**：纯平铺按时间排序（对照组）。

注意点：

- 数据是假数据，字段名与真实 `SessionSummary` 对齐（`projectPath` / `source` / `updatedAt` / `messageCount` / `size` / `snippet`）。
- 折叠状态存在 localStorage（key `mockup.collapsed`）。
- 配色取自现有暗色主题（`#0b0d0e` 背景 / `#57d9a3` accent）。
