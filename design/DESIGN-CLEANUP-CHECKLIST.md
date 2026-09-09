# Design Cleanup Checklist — 设计资产清理清单

> 生成日期：2026-09-09
> 依据：`DESIGN-GOVERNANCE.md` 分流规则
> 原则：**逐批迁移，每批跑一次对账脚本，不破坏 git 历史**

---

## A. design/plans/ → docs/project/（实现结果，6 篇）

这些文件名含 `result`/`debug`，内容是实现后的根因分析或结果记录，不是设计文档：

| 文件 | 迁移到 | 理由 |
|------|--------|------|
| `codeblock-ui-result.md` | `docs/project/codeblock-ui-result.md` | UI 调整实现结果 |
| `emoji-category-result.md` | `docs/project/emoji-category-result.md` | Emoji 实现结果 |
| `heading-fix-result.md` | `docs/project/heading-fix-result.md` | Heading bug 修复结果 |
| `image-alt-editor-result.md` | `docs/project/image-alt-editor-result.md` | 图片 alt 编辑器实现结果 |
| `presentation-mode-result.md` | `docs/project/presentation-mode-result.md` | 演示模式实现结果 |
| `slash-command-debug-result.md` | `docs/project/slash-command-debug-result.md` | 斜杠命令调试结果 |

---

## B. design/plans/ → Obsidian（头脑风暴/调研，2 篇）

| 文件 | 迁移到 | 理由 |
|------|--------|------|
| `code-caption-research.md` | `方案/竞品与生态调研/Code Caption 语法调研.md` | 调研，非定稿设计 |
| `empty-tab-blockids-cross-platform.md` | `开发细节/UI布局与Block/空Tab BlockIDs跨平台排查.md` | 排查记录，非设计 |

---

## C. docs/project/ → design/plans/（设计文档误放实现目录，3 篇）

| 文件 | 迁移到 | 理由 |
|------|--------|------|
| `combine-dashboard-design.md` | `design/plans/combine-dashboard.md` | 设计文档（仪表盘方案），非实现事实 |
| `aisession-overview-performance-proposal.md` | `design/plans/aisession-overview-performance.md` | 性能优化方案，非实现事实 |
| `herdr-terminal-embedding-analysis.md` | → Obsidian `方案/竞品与生态调研/Herdr终端嵌入分析.md` | 竞品调研，非实现事实 |

---

## D. docs/project/ → Obsidian（调研/分析文档，2 篇）

| 文件 | 迁移到 | 理由 |
|------|--------|------|
| `modern-cli-tools.md` | `方案/竞品与生态调研/现代CLI工具嵌入调研.md` | 工具调研，非实现事实 |
| `snorkeling-execution-plan.md` | `方案/架构与文档/Snorkeling执行计划.md` | 执行计划，非实现事实 |

---

## E. design/prototypes/_to-delete/ 清理（26 个过时原型）

执行 `git rm design/prototypes/_to-delete/<file>` 或确认后批量删除。

当前 `_to-delete/` 内容：

```
_litter_cards.html                    _litter_cards.txt
_litter_themes.json                   accent-color-candidates.html
agent-card-responsive.html            agent-status-current.html
agent-terminal-redesign.html          button-accent-redesign.html
card-wireframe.html                   checkbutton-redesign.html
combine-vs-overview.html              commontext-feedback-toast.html
commontext-list-row-hover-actions.html  commontext-save-dialog-tags.html
debug-commontext-overflow.html        filter-redesign.html
markdown-inline-code-wrap.html        move-block-modal.html
session-detail-redesign.html          sessions-redesign.html
tag-chips.html                        tag-chips.png
terminal-agent-redesign.html          theme-design.html
tooltip-overflow-redesign.html        x-button-adaptive.html
```

---

## F. design/prototypes/ README 补状态标记（4 个缺失）

这些原型 README 没有状态标记，需要确认后补充：

| 文件 | 需确认 |
|------|--------|
| `design/prototypes/markdown-banner/README.md` | 现状是 ▲ 活跃还是 ▼ 过时？ |
| `design/prototypes/new-agent-panel/README.md` | 同上 |
| `design/prototypes/shell-settings/README.md` | 同上 |
| `design/prototypes/vcs-block-tabs/README.md` | 同上 |

---

## G. design/plans/ 的 agent-dashboard.md 处置

我刚写的 `agent-dashboard.md` 是**产品设计方案**（头脑风暴阶段），按规则应该：
- **方案草稿** → Obsidian `方案/竞品与生态调研/Agent Dashboard 监控看板方案.md`（带 Frontmatter）
- **如果后续定稿** → 留在 `design/plans/`（加状态标记 ▲ + 镜像源）

---

## 执行顺序

| 批次 | 内容 | 风险 | 验证 |
|------|------|------|------|
| 第 1 批 | B + D（Obsidian 迁入，无 git 影响） | 零 | Obsidian 搜索确认 |
| 第 2 批 | A + C（design/plans ↔ docs/project 互调） | 低（git mv） | `git status` 确认 |
| 第 3 批 | F（补状态标记） | 零 | 跑对账脚本 |
| 第 4 批 | E（_to-delete 清理） | 中（确认后删） | `git status` 确认 |
| 第 5 批 | G（agent-dashboard 归位） | 零 | 同上 |

> **建议**：第 1、3、5 批可立即执行（无风险）；第 2、4 批建议等你确认后执行。
