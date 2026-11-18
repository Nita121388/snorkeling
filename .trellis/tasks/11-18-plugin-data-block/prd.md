# 数据 Block 插件化：指标看板与插件化 Block 调研与方案

## Goal

调研对比插件化数据 Block 的 5 种方案（A 配置驱动 / B 命令驱动 / C 进程内插件包 / D Web 即插件 / E 分层混合），产出 Obsidian 调研对比文档 + 分层方案设计草案（P1-P4 路线），供 nita 次日评审。

## Background

- 起因：看板（session-overview / loop 台账）缺少指标类数据（正在运行多少 / 阻塞多少 / 已完成多少）。
- 核心诉求：**不把指标写死**——每个用户关心的数据不同，需要外部可安装的「插件」由 Block 显示。
- 已有前置工作：`方案/插件机制/` 下两份 RFC（进程内插件 + 生命周期/分发），本调研与它们互补。

## Requirements

- 调研基于真实代码事实（block registry / ViewModel 契约 / 数据源 / 刷新通道 / 程序化建块）。
- 外部生态对比覆盖脚本即插件、配置驱动、进程内插件、iframe 渲染四类模型。
- 方案评估含工程成本（包级估算）、安全、主题一致性、分发、与既有 RFC 的衔接。
- 产出物放 Obsidian `My Projects/Snorkling/`（思考层），不进 repo design/plans（未定稿）。

## Acceptance Criteria

- [ ] Obsidian `方案/竞品与生态调研/数据 Block 插件化-生态调研与方案对比.md` 落盘（frontmatter 合规）。
- [ ] Obsidian `方案/插件机制/数据 Block 插件化-分层方案设计（草案）.md` 落盘（frontmatter 合规）。
- [ ] 两份文档含未决问题清单（供 nita 评审拍板）。
- [ ] `python .scan_frontmatter.py`（Obsidian 侧）0 bad（若脚本可用）。

## Notes

- 本任务为调研/方案任务（planning），不产生代码。
- 定稿后：设计文档迁 `design/plans/`，P1 拆子任务入 loop 门链。
