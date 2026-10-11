# 05 · 综合车道交付指针（全块类型对标 Wolai 实现方案）

综合车道的**唯一交付物**写在 Obsidian（属于「成熟方案文档」，遵循 design/DESIGN-GOVERNANCE 的 brainstorm/plan 路由）：

`/Users/nita/Primary/obsidians/Obsidian/My Projects/Snorkling/方案/Block-Editor 笔记编辑体验升级/08-全块类型对标Wolai-实现方案.md`

本文件只做指针，不复述内容。要点：

- 综合了本目录四份调研：`02-wolai-helpcenter-features-shortcuts.md`、
  `03-siyuan-per-block-parity.md`、`04-repo-current-state-and-markdown-representability.md`，
  以及 `参考-Wolai对标/01-用户笔记-块清单与交互.md`（用户笔记车道，未归档在本目录）。
- 三条第一原则：1:1 对标 Wolai（Obsidian 档 carve-out）/ 不改主题色 / 编辑态≡预览态。
- 全块类型总矩阵 55 行（A 基础文本 19 / B 媒体与结构化 23 / C 行内与派生 13）。
- 阶段：P0 地基（零差异机制 + UI 测试基建 + bug 修复）→ P1 高性价比（10 块）→ P2 类型铺开（9 块）→ P3 降级收尾。
- **建议下一步（唯一）**：P0 的第 1–3 项（overlay scss 契约测试 / 种子结构同构测试 / CDP parity 脚本）+ 修 `--wolai-*` 悬空 token。
- 需用户拍板：A 零差异严格程度（推荐 A1 结构性零差异）、B H2–H4 字号是否向 Wolai 靠（推荐 B1 保持）、C 图片尺寸语法（推荐 C1 Obsidian `![alt|300x200](path)`）。
