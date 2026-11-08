# VCS Block Redesign — Quiet List + 全景聚合仪表盘

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/vcs/vcs.tsx, frontend/app/view/vcs/vcs-filter.ts, frontend/app/view/vcscommits/vcscommits.tsx, frontend/app/view/vcshistory/vcshistory.tsx, frontend/app/view/vcsdiff/vcsdiff.tsx
> 最后同步：2026-08-31

## 概述

基于 Quiet List 方向的 VCS Block 重设计原型，新增 Lyra 式**全景聚合仪表盘**（Dashboard）——**内嵌 4 子 Tab 分组**（总览/历史/分支/文件），把分散的 4 个单视图收拢为 Dashboard，单视图作下钻：

| 视图 | 原型 Tab | 真实文件 | 角色 |
|---|---|---|---|
| **Dashboard** | `dashboard` | 新 `dashboard.tsx`（或 `vcs.tsx` 聚合模式）| **聚合默认**：内嵌 4 子 Tab（总览·历史·分支·文件），每次只看 2 个重点区 + 顶部对比/Merge/Rebase 条 |
| Version Control | `vcs` | `frontend/app/view/vcs/vcs.tsx` | 变动详情下钻 |
| Repo Commits | `vcscommits` | `frontend/app/view/vcscommits/vcscommits.tsx` | 历史详情下钻 |
| File History | `vcshistory` | `frontend/app/view/vcshistory/vcshistory.tsx` | 文件历史下钻 |
| File Diff | `vcsdiff` | `frontend/app/view/vcsdiff/vcsdiff.tsx` | Diff 下钻 |

## 6 场景

| 场景 | 演示 |
|---|---|
| Clean | 无改动，`0 changed`，behind/ahead 均 0 |
| Dirty | 3 个 changed 文件 + 1 untracked |
| Behind/Ahead | behind 4 + ahead 1，incoming/outgoing commit 列表 |
| SVN | SVN 仓库，无分支行，Update 按钮，远端变更文件数 |
| Multi-repo | Git + SVN 嵌套仓库，面板分组 |
| Detached HEAD | `detached@a3f7b2c1`，checkout 按钮 |

## 全景聚合仪表盘（Dashboard）内嵌 4 子 Tab

顶部常驻：**对比条**（`main … feature/xxx` vs `origin/main` → 查看差异/建 PR，右侧 Merge/Rebase/Cherry-pick）+ 仓库名 + 分支 pill + KPI + Fetch/Pull/Push。
下方主体按 **4 子 Tab** 分组，每次只看 2 个重点区（避免八区平铺太挤）：

| 子 Tab | 区域 | 内容 | 下钻 |
|---|---|---|---|
| **总览** | ⑥流水线 + ⑦统计 | 同步流 + Incoming/Outgoing + 模拟 CI；贡献占比/21天热力 | `→ 详情` → `vcs` |
| **工作区** | ⑤变动 + ⑧文件级 | 变动/Untracked 文件列表 + Commit 栏；Blame/History/行级暂存(`add -p`)/Diff | `→ 详情` → `vcscommits` |
| **分支** | ①分支 + ②贮藏·标签 | 列表（`●`当前、hash、↑ahead/↓behind）、新建/切换；Stash + push/pop；Tag pills | `→ 详情` → `vcs` |
| **历史** | ④历史 + ③图谱 | 最近提交时间线（点展开→Diff）；`git log --graph --all` + 图例 | `→ 详情` → `vcshistory` |

**交互**：场景 chip 全局联动（6 场景）；Dashboard 子 Tab 独立切换；历史点展开；变动/文件级 hover 浮现；响应式 2 列 / 窄屏单列。

## 结构镜像对照

| 原型元素 | 真实组件 | 说明 |
|---|---|---|
| `.dash-head` | 新 Dashboard header | 仓库名 + 分支 pill + KPI（changed/behind/ahead）+ Fetch/Pull/Push |
| `.dash-grid` + `.dash-col` | 两栏容器 | 按子 Tab 切换，每次只显示 2 个重点区，响应式 2/1 列 |
| `.timeline` / `.tl-item` | `VcsCommitsView` ~L150 | 历史时间线，复用提交数据 |
| `.dash-filelist` / `.dash-file-row` | `FileStatusRow` ~L285 | 变动紧凑行，复用文件状态 |
| `.pipeline` / `.pipe-run` | `RemoteSection` ~L370 + CI 模拟 | 流水线：同步流 + CI 运行 |
| `.repo-header` | `RepoHeader` ~L195 | 仓库头：caret + badge + name + stats + sync/refresh/commits |
| `.repo-panel` | `RepoPanel` ~L430 | 展开面板：filter bar + Changes/Untracked/Remote 折叠区 |
| `.file-status-row` | `FileStatusRow` ~L285 | 文件行：checkbox + code + path + Diff/History（hover 浮现） |
| `.collapsible-header` | `CollapsibleHeader` ~L255 | 折叠标题：caret + title + count + actions |
| `.remote-section` | `RemoteSection` ~L370 | 远端区：upstream + behind/ahead 箭头 + incoming/outgoing |
| `.commit-bar` | commit textarea + button | 底部提交栏 |
| `.filter-bar` | `RepoFileFilterBar` ~L330 | 搜索 + 扩展名 + 类型筛选 + Reset |
| `.commits-list` | `VcsCommitsView` ~L150 | 提交列表：hash + subject + author + date + 展开文件 |
| `.history-list` | `VcsHistoryView` ~L120 | 文件历史：单文件 log --follow |
| `.diff-view` | `VcsDiffView` ~L140 | Diff：side-by-side / inline 切换 + Monaco 或 patch 降级 |

## 设计原则

1. **去掉深色半透明**：`bg-black/*` → `var(--block-bg-color)` 纯浅色
2. **Badge 简化**：`C:2 U:1` → `3 changed`；`↓4 ↑1` 带色箭头
3. **次要操作 hover 浮现**：`Diff/History` 不常驻
4. **tabular-nums** 数字对齐
5. **accent 仅用于**：主按钮 + 选中竖线 + 链接
6. **border-radius**：8px 容器 / 4px 按钮 / 6px badge

## 落地计划

见同目录 `PLAN.md`。
