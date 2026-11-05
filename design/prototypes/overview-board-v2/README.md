# Overview 看板 v2 原型（时间线 / 甘特）

- `timeline-gantt.html` —— Overview 第三种视图（时间线）原型，两版对比：
  - **G1 会话寿命条**：只用 `SessionSummary.createdAt/updatedAt`，零埋点，可直接实现
  - **G2 状态分段**：需要 per-block 状态历史（环形 buffer）
  - 右上还有 2h / 8h / 24h / 7d 四档时间窗，可直接切
- 设计文档（数据契约 / segments 模型 / 验证设计）：`../../plans/overview-board-timeline.md`

## 怎么看

直接浏览器打开 `timeline-gantt.html`（无依赖，纯静态）。

## 已落地的前两批

- A 卡片信息架构：`11-05-overview-board-v2`（emoji 头像 / 会话标题 / 状态 chip / note）
- B 多列看板：5 列常显 + 横向 `scroll-snap`
- C 视图切换与分组：见 `.trellis/tasks/11-05-overview-board-view-switch/`

本目录只放"还没实现"的形态原型；定稿后交互细节会搬进 `design/plans/`。
