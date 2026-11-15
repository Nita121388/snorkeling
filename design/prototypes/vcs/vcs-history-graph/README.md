# VCS History Graph — 泳道提交图原型

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/vcs/vcs-history-tab.tsx, frontend/app/view/vcs/vcs-tabs.tsx, pkg/wshrpc/wshremote/vcs.go
> 最后同步：2026-11-14

## 概述

Version Control Block 的 **History tab** 重设计原型：把现有纯文本提交列表升级为
「左侧泳道提交图 + 富信息提交行」，对标参考截图（Git 客户端风格）：

| 元素 | 实现 | 数据来源（落地时） |
|---|---|---|
| 泳道图 | 节点圆点 + 贝塞尔连线，分支各占一泳道一色；HEAD 节点带光环 | `git log %P`（parents） |
| ref 徽章 | `HEAD → main` / `origin/main` / `tag v2.4` / 分支名（分支色与泳道一致） | `git log %D`（refs） |
| 作者 | 首字母色块头像 + 名字（生产可升级为 email→GitHub/GitLab 头像） | `git log %ae` |
| hash | mono chip，hover 行时出现复制 / 打开远端按钮 | `%H` |
| 时间 | 相对时间，tabular-nums 右对齐 | `%ad`（前端算相对值） |
| 展开 | 点击行展开变更文件（M/A/D 状态色 + ±行数统计 + diff 按钮），展开块左缘泳道连线延续 | `git show --name-status --numstat` |
| 过滤/分页 | 保留现有 keyword / since-until / page size / 上下页 | 现有 `RemoteVcsCommitsCommand` |

## 文件

| 文件 | 职责 |
|---|---|
| `index.html` | Block 外框（镜像真实 vcs.tsx / VcsRepoHeader / VcsTabBar / 过滤栏结构） |
| `style.css` | 深/浅双主题，token 对齐 `frontend/app/theme.scss`（深色=#222 系、浅色=#ebe5d9 系） |
| `data.js` | 23 条 mock 提交，含 parents/refs/email——形状对齐计划中的 Go 返回结构 |
| `graph.js` | **纯函数泳道布局算法 + SVG 路径生成**（可直接移植为 `frontend/app/view/vcs/graph-layout.ts`） |
| `graph.test.cjs` | 算法自测（`node graph.test.cjs`，零依赖）：泳道唯一性、可达性、汇合保色、分页健壮、SVG 无 NaN |
| `script.js` | 渲染 + 交互（过滤/分页/展开/复制/主题切换） |
| `screenshots/` | `dark.png`（含展开态）/ `light.png` / `filtered.png`（keyword=merge 过滤态，Chrome headless 实拍） |

## 泳道算法（graph.js，纯函数）

- **模型**：一条泳道持有「它正在等待的 commit id」。到达该 commit 即消费泳道；
  首父继承该泳道，额外父（merge）在其右侧开新泳道。
- **汇合**：父节点已被其他泳道等待时，两条泳道合并——**节点泳道接管**（保住主线色），
  等待泳道消失（保证不出现重复泳道、不出现悬空泳道，`graph.test.cjs` 全绿）。
- **颜色**：泳道色绑定**分支名**（`colorForCommit` 回调：HEAD/branch ref → 固定色表），
  翻页/过滤后颜色稳定；无 ref 的提交继承创建者泳道色，兜底调色板循环。
- **展开块沟槽**：`gutterSvg()` 在展开的文件面板左缘画所有活跃泳道的直线延续，
  连线视觉上不断。

## URL 演示参数（仅原型）

`?theme=light|dark&expand=c20,b2&keyword=merge&pagesize=10&hover=1`

- `hover=1` 强制显示行尾动作按钮（否则仅 hover 可见，截图拍不到）
- 例：`index.html?theme=light&expand=c19`

## 已知取舍（与真实组件对齐时保留）

1. **跨页断线**：分页按当前页切片计算泳道，翻页处连线断开（第一版接受；
   后续可改「无限滚动 + 增量补齐」）。
2. **SVN 降级**：SVN 无 parents/refs → 不渲染泳道列，退回纯列表样式（数据层判空）。
3. **头像**：原型用首字母色块；落地时可按 `browseurl` 判定 GitHub/GitLab 并用
   email hash 拉远端头像，失败回退色块。
4. **合流处颜色切换**：两条泳道等待同一 commit 时，存活泳道取最后接管者颜色，
  与 VSCode Git Graph 行为一致。

## 落地计划（真实组件改动点）

1. `pkg/wshrpc/wshrpctypes.go`：`VcsCommitInfo` 增加 `Parents []string` / `Refs []string` / `AuthorEmail string`
2. `pkg/wshrpc/wshremote/vcs.go`：git log 格式扩为 `%H%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%P%x1f%D%x1e` + `parseGitCommits` 扩解析（含单测）
3. `frontend/app/view/vcs/graph-layout.ts`：移植 `graph.js`（算法不变量带单测）
4. `frontend/app/view/vcs/vcs-history-tab.tsx`：按本原型重构 History tab
5. 验收：Go 单测 + `scripts/verify` 真机截图比对（结论入 `docs/project/verify-ledger.md`）

## 相关

- 前置讨论：VCS Block 整体重设计见 `../vcs-block-redesign/`（本原型是其 History 部分的深挖）
- 参考样式：用户提供的两张截图（Git 客户端深色提交图风格）
