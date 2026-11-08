# design/prototypes — 原型总入口

交互原型按**功能域**分目录存放；实现/落地状态以各原型目录内 `README.md` 顶部状态标记为准（遵循 `PROCESS.md`：▲ 设计活跃 / ◐ 部分落地 / ● 已落地 / ▼ 过时）。

## 功能域

| 目录 | 内容 |
|---|---|
| [`agent/`](agent/) | Agent 身份、卡片/hover、状态、New Agent 面板、属性卡 |
| [`aisessions/`](aisessions/) | AI 会话列表/分组/折叠、详情与聊天重设计、标注卡、运行态指示 |
| [`overview-dashboard/`](overview-dashboard/) | Overview 看板/时间线/分组视图/Combine 探索 |
| [`files-preview/`](files-preview/) | Files 块、头部交互、收藏、Markdown Banner、保存冲突保护 |
| [`vcs/`](vcs/) | VCS block/tabs/header、repo 切换、状态设置、目录树 VCS 标记 |
| [`tabs-shell-launch/`](tabs-shell-launch/) | Tab/InlineTab、Block 移动/侧栏、启动入口、Widget、Shell 设置 |
| [`editor-block-ux/`](editor-block-ux/) | 块信息卡、消息队列等编辑交互 |
| [`commontext/`](commontext/) | 常用文本：云同步、列表元信息、compose/search 等探索 |
| [`connections-settings/`](connections-settings/) | SSH/连接配置编辑 |
| [`design-foundations/`](design-foundations/) | 设计系统、浅色主题探索、边界评审稿、品牌/素材 |
| [`collab/`](collab/) | 群组/成员/消息/主持人/注册（原 `ui-prototypes`） |
| [`_archive/`]( _archive/) | 归档：历史元文档、根部重复原型快照（不作为现行入口） |

## 约定

- 每个原型子目录/独立原型应有 `README.md`，包含：`同步状态`、`镜像源`、`最后同步`（见 `PROCESS.md`）。
- **状态与位置解耦**：目录表达功能归属；●/▼ 等状态写在 README，不再用 `_to-keep` 之类分桶。
- 根目录不再放“匿名”原型 HTML；新增原型放入对应功能域。
- 详细清单/现状见 [`__INDEX__.md`](__INDEX__.md)。历史审阅指南归档于 `_archive/meta/__REVIEW_GUIDE__.md`。

## 本次整理（2026-11-08）

- 将顶层原型按功能域分组归位；`_to-keep` 内容拆入对应域；`_review-boundary` 并入 `design-foundations/review-boundary/`。
- 根部散落 `index.html` → `aisessions/list-grouping-modes/`，`quick-launch.html` → `tabs-shell-launch/`，`vcs-block-redesign.html`（根部副本）→ `_archive/meta/`。
- `collab/ui-prototypes` 保留子结构整体迁入 `collab/`。
