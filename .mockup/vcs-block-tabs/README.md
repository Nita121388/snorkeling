# VCS Block — 三 Tab 下拉面板原型

> 状态：▲ 原型（未实现）

---

## 一、目标

将 VCS Block 的下拉面板（hover 面板）从单一文件列表改为 **三个 Tab 页面**：

| Tab | 图标 | 内容 |
|-----|------|------|
| **文件改动** | `code-commit` | 当前的 Changes + Untracked + Commit 功能 |
| **分支** | `code-branch` | 本地/远程分支列表、切换、创建、当前分支高亮 |
| **流水线** | `timeline` | CI 运行列表（GitHub Actions / GitLab CI）、状态、耗时 |

### 顶部常驻区

- 仓库名 + 分支 pill（带圆点）
- KPI：changed / behind / ahead
- 同步按钮：Fetch / Pull / Push

---

## 二、原型说明

### 场景切换

6 个场景覆盖不同仓库状态：

| 场景 | 说明 |
|------|------|
| Clean | 无改动 |
| Dirty | 有文件改动 + 未跟踪 |
| Behind/Ahead | 远端不同步 |
| SVN | SVN 仓库（无分支 Tab） |
| Multi-repo | 多仓库嵌套 |
| Detached HEAD | 游离 HEAD |

### Tab 交互

- 点击 Tab 切换内容区
- 分支 Tab：点击分支行触发切换 toast
- 流水线 Tab：点击运行行展开详情
- 所有 hover 效果与生产一致

---

## 三、文件结构

```
.mockup/vcs-block-tabs/
├── README.md     ← 本文件
├── index.html    ← 可交互原型
├── style.css     ← 设计 token 对齐
└── script.js     ← 交互逻辑 + 场景数据
```

---

## 四、与 Lyra 的对齐

参考 `packages/desktop/src/components/git/GitPanel.tsx`：
- Tab 栏：图标 + 文字，窄屏仅图标
- 顶部同步行：分支名 + Pull/Push/Fetch
- 分支视图：本地/远程分区，当前分支高亮，ahead/behind badge
- 流水线视图：状态圆点 + 标题 + 分支 + 耗时 + 展开详情

---

## 五、后续落地路径

1. **Phase 1**：`vcs.tsx` 插入 Tab 骨架，RepoPanel 移入"文件改动"Tab
2. **Phase 2**：新增 `vcs-branches.tsx` + 后端 `RemoteVcsBranchListCommand`
3. **Phase 3**：新增 `vcs-pipelines.tsx` + 后端 `RemoteVcsPipelinesCommand`
