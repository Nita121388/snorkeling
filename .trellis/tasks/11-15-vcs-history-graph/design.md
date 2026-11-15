# 技术设计：VCS History 泳道提交图

## 1. 数据层（Go）

### 1.1 类型扩展 `pkg/wshrpc/wshrpctypes.go`

```go
type VcsCommitInfo struct {
    Hash        string   `json:"hash,omitempty"`
    Author      string   `json:"author,omitempty"`
    AuthorEmail string   `json:"authoremail,omitempty"`
    Date        string   `json:"date,omitempty"`
    Subject     string   `json:"subject,omitempty"`
    Parents     []string `json:"parents,omitempty"`
    Refs        []string `json:"refs,omitempty"`
}

type VcsCommitFileInfo struct {
    Path    string `json:"path"`
    Code    string `json:"code,omitempty"`
    Added   int    `json:"added,omitempty"`
    Deleted int    `json:"deleted,omitempty"`
}
```

**向后兼容**：全部新字段 omitempty；旧 Go/新前端、新 Go/旧前端均不炸（前端判空）。

### 1.2 git log 格式（两处调用点）

`loadGitCommitsWithOffset`（History 分页，`%ad`）与 `loadGitRemoteCommits`（Remote 区，`%aI`）：
新字段**追加在末尾**，保持既有字段下标不变（`parseGitCommits` 老分支仍可解析）：

```
%H%x1f%an%x1f%ad%x1f%s%x1f%ae%x1f%P%x1f%D%x1e
                 ↑ 追加：email / parents / refs
```

`parseGitCommits`：
- `len(fields) < 4` 跳过（原逻辑）
- 字段 4 = email；字段 5 = parents（空格分隔，空串 → nil）；字段 6 = refs（逗号分隔，`%D` 原文）

**refs 保留 `%D` 原始 token 列表**（`HEAD -> main`、`tag: v2.4`、`origin/main`），
由前端解析成徽章类型——避免在 Go 侧做展示层判断。

### 1.3 commit files 加 numstat

`git show` 的 `--numstat` 与 `--name-status` 是互斥输出格式（实测定论：同时传只出 name-status），
故 `loadGitCommitFiles` 发**两次**调用：

1. `git show --name-status --pretty=format: <rev>`（现有逻辑，状态码来源）
2. `git show --numstat --pretty=format: <rev>`（新增，行数来源）

按 path 精确匹配合并 `Added/Deleted`；重命名（`{a => b}` / `old => new`）不匹配则保留 0
（前端 0 不渲染 ±，宁可少显示也不猜错）。

## 2. 前端算法 `frontend/app/view/vcs/graph-layout.ts`

从原型 `graph.js` 原样移植（纯函数、无 DOM）：

```ts
export type LaneColor = string;
export interface GraphCommit { id: string; parents?: string[]; refs?: string[]; }
export interface GraphRowInput extends GraphCommit {}
export interface GraphRow<C extends GraphCommit> {
    commit: C;
    topLanes: Lane[];
    bottomLanes: Lane[];
    nodeLane: number;
    nodeColor: LaneColor;
    parents: string[];
    parentLanes: { id: string; lane: number; color: LaneColor }[];
}
export function computeLayout<C extends GraphCommit>(
    commits: C[],
    options?: { colorForCommit?: (commit: C) => LaneColor | null }
): { rows: GraphRow<C>[]; maxLanes: number; width: number };
export function rowSvg(row: GraphRow<any>, height: number): string;
export function gutterSvg(bottomLanes: Lane[], height: number): string;
export const GRAPH_GEO = { rowHeight, laneWidth, padLeft, nodeRadius, headRadius };
```

算法不变量（与原型 `graph.test.cjs` 对齐，写成 vitest 用例）：
1. 每个 commit 恰好一行；2. 任一行的 bottomLanes 无重复 id；3. 末行 bottomLanes 为空；
4. 每个 parent 都有可画的 parentLane；5. 汇合处保主线色；6. 颜色由分支身份决定（`colorForCommit`）。

## 3. 前端 UI

### 3.1 文件划分

| 文件 | 内容 |
|---|---|
| `frontend/app/view/vcs/graph-layout.ts` | 纯算法（上面 §2） |
| `frontend/app/view/vcs/graph-layout.test.ts` | vitest 用例 |
| `frontend/app/view/vcs/vcs-history-graph.tsx` | 泳道列组件 `CommitGraphCell` + 展开沟槽 `CommitGraphGutter` |
| `frontend/app/view/vcs/vcs-history-tab.tsx` | 重构：行布局（graph │ refs+subject │ hash │ author │ time │ actions）、徽章解析、头像、过滤/分页保留 |

### 3.2 refs 解析（前端）

`parseGitRefs(refs: string[]): {type: "head"|"branch"|"tag"|"remote", name: string}[]`
- `HEAD -> x` → head(x)；裸 `HEAD` → head("HEAD")
- `tag: x` → tag
- 含 `/` 且非 `tag:` / 非 `HEAD ->` → remote
- 其余 → branch

### 3.3 颜色

`colorForCommit`：commit 的 head/branch ref 名 → 固定调色板（`LANE_COLORS`，主分支下标 0 蓝）；
无 ref 的提交继承泳道创建者颜色，兜底调色板游标。徽章文字色 = 同色；背景 = 同色 14% alpha。

### 3.4 行高与滚动

行高固定 `--row-h: 46px`（`GRAPH_GEO.rowHeight`），展开面板另起一行（grid 两列：沟槽 + 文件列表），
沟槽用 `gutterSvg` 画所有 bottomLanes 的直线延续。

### 3.5 头像

`initials(name)` + `avatarColor(name)`（字符串哈希取调色板），18px 圆形色块 + 内描边。
不做网络头像（离线可用优先；GitHub/GitLab 头像留作后续增强）。

## 4. 兼容与取舍

| 项 | 决策 |
|---|---|
| SVN | 无 parents/refs → `maxLanes<=1` 时不渲染泳道列（退化为纯列表，样式与现状一致） |
| 分页 | 泳道只在当前页切片内计算（翻页断线，已接受） |
| merge commit 文件列表 | 沿用现有 `git show` 默认（combined diff 可能为空），不改变既有行为 |
| i18n | main 无 i18n 基建；沿用硬编码英文，迁移归 `11-14-i18n-rollout` |
| tsc 基线 | 不新增 any 扩散；行/泳道类型显式标注 |

## 5. 回滚

纯前端 + 可选字段扩展：
- 前端回滚 = revert 提交（`vcs-history-tab.tsx` 恢复原版，`graph-layout.ts` 删除）
- Go 字段保留无副作用（omitempty），无需回滚数据层
