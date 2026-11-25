# Overview 看板 v2 原型（时间线 / 甘特）

## 同步状态

> `timeline-gantt.html` ▲ 设计活跃（G1/G2.1 已落地生产，G2 待环形历史）
> `turn-gantt.html` ▲ 设计活跃（G3 按对话轮拆分，2026-11-25 新增，未实现）

- `timeline-gantt.html` —— Overview 第三种视图（时间线）原型，两版对比：
  - **G1 会话寿命条**：只用 `SessionSummary.createdAt/updatedAt`，零埋点，可直接实现
  - **G2 状态分段**：需要 per-block 状态历史（环形 buffer）
  - 右上还有 2h / 8h / 24h / 7d 四档时间窗，可直接切
- `turn-gantt.html` —— **G3 按对话轮拆分**（2026-11-25）：条内按轮切成
  空闲 / 思考〔估算〕/ 工具执行〔精确〕/ 回复生成 四类段 + 每轮完成点，
  数据全部来自 SQLite 消息索引现有时间戳（零新埋点）；
  内置 30m/2h/8h/24h 窗口、段数封顶开关（每行 ≤60 段）、降级行演示。
  段公式、真机比例验证与后端接口草案见 `../../plans/overview-board-timeline.md` §8。
- 设计文档（数据契约 / segments 模型 / 验证设计）：`../../plans/overview-board-timeline.md`

## 怎么看

直接浏览器打开 `timeline-gantt.html`（无依赖，纯静态）。

## 已落地的前两批

- A 卡片信息架构：`11-05-overview-board-v2`（emoji 头像 / 会话标题 / 状态 chip / note）
- B 多列看板：5 列常显 + 横向 `scroll-snap`
- C 视图切换与分组：见 `.trellis/tasks/11-05-overview-board-view-switch/`

本目录只放"还没实现"的形态原型；定稿后交互细节会搬进 `design/plans/`。
