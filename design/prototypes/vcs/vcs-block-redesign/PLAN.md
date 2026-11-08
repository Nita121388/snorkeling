# VCS Block Redesign — 落地计划

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/vcs/vcs.tsx, frontend/app/view/vcs/vcs-filter.ts, frontend/app/view/vcscommits/vcscommits.tsx, frontend/app/view/vcshistory/vcshistory.tsx, frontend/app/view/vcsdiff/vcsdiff.tsx, pkg/wshrpc/wshremote/vcs.go, pkg/wshrpc/wshrpctypes.go
> 最后同步：2026-08-31

---

## 一、现状诊断

### 1.1 架构总览

```
frontend (4 blocks)           wshrpc (types)           wshremote (Go)
─────────────────────         ──────────────           ──────────────
vcs.tsx           ──RPC──►  RemoteVcsRepositories  ──►  detectRepoRoots()
vcs-filter.ts     ──RPC──►  RemoteVcsCommit        ──►  loadGitRepoState()
vcscommits.tsx    ──RPC──►  RemoteVcsSync          ──►  loadGitRemoteState()
vcshistory.tsx    ──RPC──►  RemoteVcsFileHistory   ──►  commitGit/commitSvn()
vcsdiff.tsx       ──RPC──►  RemoteVcsFileDiff      ──►  parseGitAheadBehind()
```

### 1.2 问题清单

| # | 问题 | 影响 | 修复代价 |
|---|---|---|---|
| V1 | `bg-black/15` `bg-black/25` `border-white/10` 深色半透明在浅色主题下发灰 | 全局 | 低 — Tailwind class 替换 |
| V2 | `C:2 U:1 R:1` 机器缩写不直观 | 信息密度 | 低 — 改文案 |
| V3 | `Behind 4 / Ahead 1` 双 pill 占位大 | 布局 | 低 — 合并为 `↓4 ↑1` |
| V4 | `Diff/History` 常驻导致行高拥挤 | 视觉 | 中 — hover 浮现 |
| V5 | 无 `tabular-nums` 数字跳动 | 对齐 | 低 — 加 class |
| V6 | 无虚拟列表 `statuslimit:300` 直接渲染 | 性能 | 中 — 引入 `@tanstack/virtual` |
| V7 | 缺分支切换/创建 | 功能 | 中 — 新增 RPC |
| V8 | 缺 Stash/Rebase/Merge/Tag | 功能 | 高 — 新增 RPC |
| V9 | 缺 Blame/Commit Graph | 功能 | 高 — 新增 Block |
| V10 | 缺 Command Palette 入口 | 交互 | 中 — Cmd+K 路由 |

---

## 二、推荐方案：Quiet List + 全景聚合仪表盘（方案 A+）

> 补齐 Lyra 式全景聚合：把分散的 4 个 Block（vcs / vcscommits / vcshistory / vcsdiff）收拢为默认的 Dashboard，**内嵌 4 子 Tab 分组**（每组 2 个重点区），单视图作下钻。

### 2.0 全景聚合仪表盘（Dashboard）

**定位**：`Dashboard` 为默认 Tab，**内嵌 4 子 Tab 分组**（总览/工作区/历史/分支），每次只看 2 个重点区，避免八区平铺太挤：

| 子 Tab | 区域 | 内容 | 数据源 | 下钻 |
|---|---|---|---|---|
| **总览** | ⑥流水线 + ⑦统计 | 同步流 + Incoming/Outgoing + 模拟 CI；贡献占比/21天热力 | `VcsRemoteState` + `SAMPLE_CONTRIB` | `→ 详情` → `vcs` |
| **工作区** | ⑤变动 + ⑧文件级 | 变动/Untracked 文件列表 + Commit 栏；Blame/History/行级暂存(`add -p`)/Diff | `RemoteVcsRepositoriesCommand` + 文件状态 | `→ 详情` → `vcs` |
| **分支** | ①分支 + ②贮藏·标签 | 分支列表（`●`当前、hash、↑ahead/↓behind）、新建/切换；Stash + push/pop；Tag pills | `git branch -a` / `git stash list` / `git tag` | `→ 详情` → `vcs` |
| **历史** | ④历史 + ③图谱 | 最近提交时间线（点展开→Diff）；`git log --graph --all` + 图例 | `RemoteVcsCommitsCommand` | `→ 详情` → `vcscommits` |

**顶部常驻**：对比条（`main … feature/xxx` vs `origin/main` → 查看差异/建 PR，右侧 Merge/Rebase/Cherry-pick）+ 仓库名 + 分支 pill + KPI（changed/behind/ahead）+ Fetch/Pull/Push。

**交互**：
- 场景 chip 全局联动 6 场景；Dashboard 子 Tab 独立切换；历史点展开；变动/文件级 hover 浮现；CI 点 `success/running/queued` 脉动。
- 响应式：大屏 2 列 / 窄屏单列。

### 2.1 推荐方案：Quiet List (方案 A)

### 2.1 核心原则

1. **去掉深色半透明**，用 `var(--block-bg-color)` / `var(--color-surface)` 纯浅色背景。
2. **Badge 简化**：`C:2 U:1 R:1` → `3 changed`；`↓4 ↑1` 带色箭头。
3. **次要操作 hover 浮现**：`Diff/History` 不常驻，hover 行才出现。
4. **tabular-nums** 给所有数字列（hash/date/behind/ahead）。
5. **accent 仅用于**：`Commit` 主按钮 + 选中态竖线 + 链接色。
6. **border-radius 统一**：8px (容器) / 4px (按钮/input) / 6px (badge)。

### 2.2 视觉对照

| 维度 | 当前 | 重设计 |
|---|---|---|
| 背景色 | `bg-black/15` `bg-black/25` | `var(--block-bg-color)` 纯浅色 |
| 状态数字 | `C:2 U:1 R:1` pill | `3 changed` 文字 + `↓4 ↑1` |
| 次要操作 | 常驻下划线 | hover 浮现 |
| accent 用量 | 多（hover/soft bg/badges） | 少（链接 + 主按钮） |
| "AI 味" | 强（pill + accent 软背景） | 无（克制） |

---

## 三、实施阶段

### Phase 0 — P0 Dashboard 全景聚合仪表盘（2 天）

**范围**：新增 `dashboard` 为默认视图，顶部对比条 + 八区网格，零后端增量（复用已有 RPC + 模拟数据）。

- [x] `script.js`/`index.html` 已落地原型：对比条 + 分支·贮藏/标签·图谱·历史·变动·流水线·统计·文件级 八区 + 全局场景联动 + 响应式 3/单列。
- [ ] 前端新增 Dashboard 组件（或 `vcs.tsx` 内新增聚合模式开关），复用 `RemoteVcsRepositoriesCommand` / `RemoteVcsCommitsCommand` 数据。
- [ ] 后续 Phase 4/5/6 将分支/贮藏/图谱的模拟数据替换为真实 RPC。

**文件**：`frontend/app/view/vcs/dashboard.tsx`（新）或 `frontend/app/view/vcs/vcs.tsx` 内聚模式

### Phase 1 — P0 视觉重构（1-2 天）

**范围**：仅改 `vcs.tsx`，零后端改动，零风险。

- [ ] 替换 `bg-black/15` `bg-black/25` `border-white/10` → `bg-[var(--block-bg-color)]` `border-border`。
- [ ] `RepoHeader` 统计改为 `3 changed` 文案 + `↓4 ↑1` 箭头。
- [ ] `FileStatusRow` 加 `tabular-nums` 给 code 列。
- [ ] `RemoteSection` behind/ahead pill 合并为带色箭头。
- [ ] `Diff/History` 按钮改为 hover 浮现（opacity: 0 → 1 transition 120ms）。
- [ ] 所有按钮统一：primary = `bg-action`，ghost = `border-border`。
- [ ] `CollapsibleHeader` 去 `bg-black/20` → `bg-transparent`。

**文件**：`frontend/app/view/vcs/vcs.tsx`

### Phase 2 — P0 Hover 面板落地（1 天）

**范围**：前端缓存复用，零后端改动。

- [ ] `IconButtonDecl` 增加可选 `tooltipNode?: React.ReactNode`。
- [ ] `iconbutton.tsx` 有 `tooltipNode` 时外包 `<Tooltip>`。
- [ ] `preview-model.tsx` vcsButton 挂面板 ReactNode。
- [ ] `preview-directory-utils.tsx` 导出 `resolveRepoForPath` + cache。
- [ ] hover 350ms 延迟弹开，移开 250ms 宽限收起。

**文件**：`frontend/app/block/blockframe-header.tsx`, `frontend/app/element/iconbutton.tsx`, `frontend/app/view/preview/preview-model.tsx`, `frontend/app/view/preview/preview-directory-utils.tsx`

### Phase 3 — P0 虚拟列表 + 筛选优化（1 天）

- [ ] 引入 `@tanstack/react-virtual` 虚拟化 `FileStatusRow`。
- [ ] `RepoFileFilterBar` 搜索防抖 300ms。
- [ ] `extension` 输入支持 `.tsx,.scss` 多值。
- [ ] `statuslimit` 自适应：文件 < 50 用 50，> 50 用 300。

**文件**：`frontend/app/view/vcs/vcs.tsx`, `frontend/app/view/vcs/vcs-filter.ts`

### Phase 4 — P1 分支切换（2 天）

**范围**：新增后端 RPC + 前端 UI。

- [ ] `wshrpctypes.go` 新增 `CommandRemoteVcsBranchListData` / `RemoteVcsBranchListRtnData`。
- [ ] `vcs.go` 新增 `RemoteVcsBranchListCommand`：`git branch -a`。
- [ ] `vcs.tsx` `RepoHeader` 分支名改为可点击 `<select>`。
- [ ] 点击触发 `git checkout <branch>`（复用 `RemoteVcsSyncCommand` 通道）。

**文件**：`pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshremote/vcs.go`, `frontend/app/view/vcs/vcs.tsx`

### Phase 5 — P1 Stash 能力（2 天）

- [ ] `wshrpctypes.go` 新增 `CommandRemoteVcsStashData` / `RemoteVcsStashRtnData`。
- [ ] `vcs.go` 新增 `RemoteVcsStashCommand`：`git stash push/list/pop`。
- [ ] `vcs.tsx` 顶栏新增 `Stash` 按钮（behind > 0 或 changed > 0 时显示）。

### Phase 6 — P2 Commit Graph（3 天）

- [ ] `wshrpctypes.go` 新增 `CommandRemoteVcsGraphData` / `RemoteVcsGraphRtnData`。
- [ ] `vcs.go` 新增 `RemoteVcsGraphCommand`：`git log --graph --oneline --all`。
- [ ] `vcscommits.tsx` 列表左侧渲染 `cytoscape`（已在 dist）分支图。
- [ ] 新增 `graph` 视图模式开关（list / graph）。

### Phase 7 — P2 Blame + 冲突（2 天）

- [ ] 新增 `vcsblame` Block（复用 `DiffViewer`，`git blame -n` 逐行渲染）。
- [ ] `FileStatusRow` `code == C/U` 高亮 `warning` 背景。
- [ ] 冲突态提供 `Accept ours / theirs / both` 按钮。

### Phase 8 — P2 键盘 + Cmd+K（1 天）

- [ ] `j/k` 导航文件列表，`Space` 勾选，`Cmd+Enter` 提交。
- [ ] `Cmd+K` Command Palette 路由到 `Git: Pull / Git: Push / Git: Stash` 等。

---

## 四、风险与缓解

| 风险 | 概率 | 缓解 |
|---|---|---|
| Tailwind class 替换遗漏 | 低 | 全局搜索 `bg-black/` `border-white/` 逐个替换 |
| 虚拟列表引入破坏已有选中态 | 中 | 保持 `selectedFiles` 状态不变，仅改渲染层 |
| 新增 RPC 与旧版本不兼容 | 低 | 新 RPC 均为新增，不改旧接口 |
| Commit Graph 渲染性能 | 中 | 限制 `--max-count=200`，超限降级为线性列表 |

---

## 五、验证清单

- [ ] 浅色主题下所有 VCS Block 视觉一致（无灰色半透明）。
- [ ] `statuslimit:300` 文件列表不卡（< 200ms 首屏）。
- [ ] Hover 面板 350ms 弹开、250ms 收起。
- [ ] 分支切换后 `branch` 即时更新。
- [ ] Stash push/pop 后 `status` 计数正确。
- [ ] `go test ./pkg/wshrpc/wshremote -run TestVcs` 全绿。

---

## 六、原型目录

```
.mockup/vcs-block-redesign/
├── README.md          ← 本文件
├── PLAN.md            ← 落地计划
├── index.html         ← 可交互原型（4 视图 + 6 场景）
├── style.css          ← 项目 token 对齐样式
└── script.js          ← 交互逻辑 + 场景数据
```

原型覆盖：`vcs`（文件列表）、`vcscommits`（提交列表）、`vcshistory`（文件历史）、`vcsdiff`（Diff 视图）。
6 个场景：`clean`（无改动）、`dirty`（有改动）、`behind-ahead`（远端不同步）、`svn`（SVN 仓库）、`multi-repo`（多仓库）、`detached`（detached HEAD）。
