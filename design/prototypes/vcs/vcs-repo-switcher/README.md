> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/vcs/vcs.tsx, frontend/app/view/vcs/vcs-tabs.tsx, pkg/wshrpc/wshremote/vcs.go
> 最后同步：2026-09-10

# VCS Block — 多仓库切换器原型

> 状态：▲ 原型（未实现）

---

## 一、背景 / 问题

打开一个含多个 git/svn 仓库的目录（如 `E:/projects`）的 VCS Block（版本管理）时：

- **后端已返回全部仓库**：`RemoteVcsRepositoriesCommand` 用 `detectRepoRoots()`（scandepth=3, includeparent=true）扫出目录下所有仓库，`Repositories` 数组完整返回（实测 `E:/projects` = 5 个仓库）。
- **前端只显示一个**：`vcs.tsx` 只渲染 `activeRepo`，加载时固定 `setActiveRepoId(repoList[0].repoid)`，**没有任何仓库切换入口**。用户只能看到排序第一的仓库，无法访问其余仓库——这就是「没正常显示多仓库」的根因。

## 二、设计目标

在 VCS Block 头部加一个**仓库切换器**，把后端已返回的多仓库真正接到 UI：

- 头部左侧（现 ⑂ + 分支 处）变成「仓库选择器」：仓库名 + repotype 徽标 + 展开箭头。
- 点开下拉列出 `repos` 全部仓库；选中即切换 `activeRepoId`，下方 Changes / Branches / **History** / Pipelines 四个 Tab 整体跟随切换。
- 仅新增 UI 层；后端 RPC、tab、commit/sync 逻辑复用（`handleSync`/`handleCommit` 已按 `repo.rootpath` 天然区分仓库）。

| Tab 页 | 镜像源 | 说明 |
|---|---|---|
| Changes | `vcs-changes-tab.tsx` | 当前仓库 status（changed/untracked） + commit |
| Branches | `vcs-branches-tab.tsx` | Git 分支列表，SVN 置灰 |
| History | `vcscommits.tsx` | 仓库提交历史列表（短 hash + subject + author + date，展开显示改动文件 + Diff） |
| Pipelines | `vcs-pipelines-tab.tsx` | CI 运行列表（占位） |

> 注：真实仓库级「历史」是 `vcscommits.tsx`（`RemoteVcsCommitsCommand`）；单文件的 `vcshistory.tsx`（`RemoteVcsFileHistoryCommand`）需要 filepath 元数据，作为独立 Block 而非 Tab，故 History Tab 镜像 vcscommits。

## 三、原型说明

### 场景切换

| 场景 | 说明 |
|------|------|
| `E:/projects`（真实） | 5 个 git 仓库，直接复现用户实际目录 |
| 单仓库 | 仅 1 个仓库时，下拉收起为只读展示（不像下拉） |
| Git + SVN 混合 | 下拉里带 GIT / SVN 徽标区分 |
| 嵌套仓库 | quartz-site 下嵌套 quartz 子仓库，路径用相对层级展示 |
| 空路径 | 无仓库，显示 "No Git/SVN repository found in this path." |

### 切换器交互

- 点击头部选择器展开下拉；再点 / 移出点击 / Esc 关闭。
- 当前仓库行高亮 + ✓；其余行 hover 高亮。
- 每行：`repo.name` + (repotype 徽标 GIT/SVN) + rootpath 副标题。
- 选中后头部立即更新：仓库名、分支、ahead/behind、changed 数、Tab 内容全部跟随。

### 文案语言约束

与现有 VCS 视图一致，应用内 UI 全部**英文**；中文只出现在评审注释区。措辞对齐：`N changed`、`↓N` / `↑N`、`No Git/SVN repository found in this path.`、`Pull`、`Refresh`。

## 四、结构镜像对照

| 原型元素 | 镜像真实源 | 说明 |
|---|---|---|
| 头部一行 `.vcs-header` | `vcs-tabs.tsx` `VcsRepoHeader` `flex h-8 ... px-2.5` | ⑂ 图标、分支、changed pill、Pull、Refresh 全对齐 |
| **新增** `.repo-switcher` 下拉 | 新组件（放入 `VcsRepoHeader` 左侧） | 数据来自 `RemoteVcsRepositoriesCommand` 已返回的 `repos[]` |
| Tab 栏 `.vcs-tabbar` | `vcs-tabs.tsx` `VcsTabBar`（Changes/Branches/Pipelines） | 分支 Tab 对 SVN disabled |
| 变更列表 `.vcs-changes` | `vcs-changes-tab.tsx` | 当前仓库 status 渲染 |
| Branches / Pipelines Tab | `vcs-branches-tab.tsx` / `vcs-pipelines-tab.tsx` | 切换后跟随 active repo |

## 五、文件结构

```
.vmockup-like design/prototypes/vcs-repo-switcher/
├── README.md   ← 本文件
├── index.html  ← 可交互原型
├── style.css   ← 设计 token 对齐
└── script.js   ← 场景数据 + 切换交互
```

## 六、落地要点（实现阶段）

1. `vcs-tabs.tsx`：`VcsRepoHeader` 增加 props `repos: VcsRepositoryInfo[]`、`currentRepoId: string`、`onRepoChange(id: string)`；新增 `VcsRepoSwitcher` 组件（自定义下拉，非原生 select，与现有菜单观感一致）。
2. `vcs.tsx`：把 `repos` / `activeRepo.repoid` / `(id) => setActiveRepoId(id)` 传给 `VcsRepoHeader`。
3. 单仓库时下拉收起为只读（避免无意义下拉）。
4. 自检：切换后头部 KPIs 与 Tab 内容随 repo 更新；SVN 仓库分支 Tab disabled；commit/sync 落在对应 `rootpath`。