> 同步状态：◐ 部分落地
> 镜像源：frontend/app/view/vcs/vcs.tsx, frontend/app/view/vcs/vcs-tabs.tsx, frontend/app/view/vcs/vcs-repo-switcher.tsx, frontend/app/view/vcs/vcs-history-tab.tsx, frontend/app/view/preview/preview-directory-utils.tsx, pkg/wshrpc/wshremote/vcs.go
> 最后同步：2026-09-10

# VCS Repo Switcher v2 — 多仓库版本管理切换器

> 关联需求：打开父目录（如 `E:\code\workspace`）时期望看到其下多个子仓库的版本管理，而非仅首个仓库。

---

## 一、问题

当前 `vcs.tsx` 的状态模型已支持多仓库（`repos[]` / `activeRepoId` / per-repo 的 `selectedFiles` / `commitMessage` / `sectionState`），但**渲染层只展示 `activeRepo`（`repos[0]`）**，无任何仓库切换 UI。

- `openVcsBlock` 传入 `vcs:path = repo.rootpath`（单仓库根），导致 `RemoteVcsRepositoriesCommand` 从仓库根扫描，仅命中自身。
- 即使 `detectRepoRoots(basePath, scanDepth=3, includeParent=true)` 返回多仓库，视图也无法切换。

用户所见即为单仓库头：`⑂ main · 0 changed · Pull · Changes/Branches/Pipelines · Type 0 files · Changes(0) / Untracked(0) / Remote(0) · Fetch/Pull/Push · Upstream origin/main Behind 0 Ahead 0`。

---

## 二、目标

在不改动后端扫描逻辑的前提下，**补齐前端多仓库切换器**，并提供从父目录打开多仓库视图的入口。

| 能力 | 现状 | v2 |
|------|------|-----|
| 仓库发现 | `RemoteVcsRepositoriesCommand(path, scanDepth=3, includeParent=true)` 已就绪 | 保持不变 |
| 视图入口 | 仅从单仓库 `repo.rootpath` 打开 | 新增「从父目录打开」→ `vcs:path = parentDir` |
| 切换器 | 无 | 顶部仓库切换器（chips / dropdown 双形态） |
| 单仓库 | 正常 | 切换器自动隐藏，零干扰 |
| 多仓库 | 仅首个可见 | 横向 chips 至多 4 个 + 溢出下拉；或紧凑下拉形态 |
| 聚合信息 | 无 | 顶部汇总条：`N repos · Σ changed · Σ behind/ahead` |
| 溢出 | — | 5+ 仓库时 chips 可横滑 + `+N` 下拉；dropdown 内支持搜索 |

---

## 三、原型说明

### 场景

| 场景 | 说明 |
|------|------|
| Single | 单仓库（无切换器） |
| Duo | 2 仓库（一净一脏） |
| Quad | 4 仓库（monorepo 子包） |
| Overflow 6+ | 横滑 + 溢出下拉 |
| Mixed | Git + SVN 混合 |
| Nested | 父目录本身是 git 仓库 + 子仓库 |

### 形态切换

- **Chips（推荐）**：横向 pill 行，直接点选；溢出可滑 + `+N` 菜单。
- **Dropdown（紧凑）**：单行选择器，适合窄面板。

### 四个 Tab（Changes / Branches / Pipelines / History）

| Tab | 内容 | 对齐源 |
|-----|------|--------|
| **Changes** | 文件改动 + 未跟踪 + Remote（Fetch/Pull/Push/Upstream/Behind/Ahead）+ Commit | `vcs-changes-tab.tsx` |
| **Branches** | 本地/远程分支列表（占位） | `vcs-branches-tab.tsx` |
| **Pipelines** | CI 运行列表（占位） | `vcs-pipelines-tab.tsx` |
| **History** | 提交历史（hash/subject/author/date，点击展开 commit 内文件 + View Diff/Open），工具栏 Keyword/Since/Until/Apply/Reset | `vcscommits.tsx` |

### 交互

- 点击仓库 pill/下拉项 → 切换 `activeRepo`，下方 RepoHeader / TabBar / TabContent 联动刷新（原型内即时切换，无请求）。
- Dropdown 内支持按仓库名/分支关键字过滤。
- 聚合条点击可展开「总览」浮层（各仓库一行摘要）。
- History 提交行点击展开/折叠文件列表。

---

## 四、文件结构

```
design/prototypes/vcs-repo-switcher-v2/
├── README.md   ← 本文件
├── index.html  ← 可交互原型（浏览器直接打开）
├── style.css   ← token 对齐 light 主题
└── script.js   ← 场景数据 + 渲染 + 交互
```

---

## 五、落地路径

1. **Phase 1**：`vcs.tsx` 新增 `VcsRepoSwitcher` 组件（chips + dropdown），`repos.length > 1` 时渲染；`activeRepoId` 切换逻辑已存在，只需接线。
2. **Phase 2**：`preview-directory-utils.tsx` 新增「打开多仓库视图」菜单项（`vcs:path = targetDir` 而非 `repo.rootpath`）。
3. **Phase 3**：History 作为第 4 个 Tab 合入 `vcs.tsx`（复用 `RemoteVcsCommitsCommand` + `RemoteVcsCommitFilesCommand`，对齐 `vcscommits.tsx`），或保留独立 `vcscommits` 视图双入口。
4. **Phase 4**：聚合条与总览浮层（可选），`MaxVcsRepos=64` 时的虚拟滚动优化。

---

## 六、与真实组件的对齐

- DOM 结构逐字段对齐 `vcs.tsx` / `vcs-tabs.tsx` / `vcs-changes-tab.tsx` / `vcscommits.tsx` 的类名与文案，仅新增「切换器」与「History Tab」两层。
- 文案与后端字段一致：`repo.name` / `repo.branch` / `repo.status` / `repo.remote.{ahead,behind,upstream}`、commit 的 `hash` / `subject` / `author` / `date` / `files`。
- 扫描参数与真实调用一致：`path: basePath, statusLimit: 300, scanDepth: 3, includeParent: true`。
