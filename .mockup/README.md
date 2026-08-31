# 会话列表分组原型（参考 Lyra）

静态原型，直接在浏览器打开 `index.html`（无需构建）：

```bash
open ~/Primary/projects/snorkeling-gui-chat/.mockup/index.html
```

三种模式，顶部切换对比：

- **A · 项目分组**（推荐）：按 `projectPath` 分组，组头可折叠（状态记住），组间按"组内最近会话时间"排序，组内按时间排，跨 source 混排，无项目者归入底部「其他」。每组默认显示 5 条 +「展开更多」。
- **B · 时间带**：平铺列表按日历天分带：今天 / 昨天 / 过去 7 天 / 过去 30 天 / 更早（Lyra「聊天」半区的做法）。
- **现状**：纯平铺按时间排序（对照组）。

注意点：

- 数据是假数据，字段名与真实 `SessionSummary` 对齐（`projectPath` / `source` / `updatedAt` / `messageCount` / `size` / `snippet`）。
- 折叠状态存在 localStorage（key `mockup.collapsed`）。
- 配色取自现有暗色主题（`#0b0d0e` 背景 / `#57d9a3` accent）。
- 该目录建议 gitignore 或随时可删，仅作设计评审用。
