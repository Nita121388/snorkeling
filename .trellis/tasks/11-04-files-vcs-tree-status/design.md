# Design — Files 目录树 VCS 变动标记（D 方案落地）

> 原型：`design/prototypes/files-vcs-tree-status/`（可切 A/B/C/D 四方案实测，结论：D）。
> 本文是 D 方案的实现契约，性能预算来自原型 README，逐条对齐。

## 语义（D 方案）

| 对象 | 文件名/文件夹名 | 行尾标记 | 颜色 |
|---|---|---|---|
| 文件 modified（M） | 变橙 | `M` | `--warning-color` |
| 文件 untracked（U） | 变绿 | `U` | `--success-color` |
| 文件 deleted（D） | 变红 + 删除线 | `D` | `--error-color` |
| **clean / 非仓库** | **完全不变色** | **无标记** | — |
| 文件夹（仓库内有变更） | 不变色 | 数字（该目录下变更文件数） | `--warning-color` |

- 「干净」必须静默：干净不显色（否则与 untracked 的绿混淆）
- 文件行不给数字（恒为 1，无信息量）；数量只在目录聚合时有意义
- 图标（文件类型色）**不换色**：icon 颜色承载文件类型语义，不能被 VCS 状态抢通道

## 两类目录

1. **子目录是独立仓库**（如 `~/Primary/projects/snorkeling` 下挂多个仓库）→
   该目录行 = 仓库整体 clean/dirty；`repositories[].status` 全量
2. **仓库内普通子目录**（如 `snorkeling/.trellis`）→ `status[]` 按路径前缀聚合出数量

## 数据与性能（硬预算）

| 指标 | 预算 | 实现 |
|---|---|---|
| RPC 次数（整棵树视图） | **1 次** | `RemoteVcsRepositoriesCommand({ path: 目录, scandepth: 2, statuslimit: 2000, includeparent: true })` |
| 每行渲染计算 | O(1) | 两套 `Map` 查表 |
| status 聚合 | O(M) 一次 | 建索引时一趟 |
| 滚动/hover 新增请求 | 0 | 缓存命中 |
| 目录切换 debounce | 250 ms | 换目录后延迟发起 |

索引构建（一次 RPC 返回后，同步 O(M) 建两套）：

```
fileMark: Map<absPath, "M"|"U"|"D">        // 相对路径 → 状态码；D 用仓库 status 里的 deleted/缺失推断
dirCount: Map<absPath, number>             // 每个祖先目录累计变更数
repoRoots: Set<string>                     // repositories[].rootpath，用于"子目录是独立仓库"判定
```

- 跳过噪音目录（`node_modules/.git/dist/build/target/.venv`）不参与聚合
- 缓存 `vcsTreeStatusCache`：key=`conn|dir`，TTL 10s；`Refresh`/VCS 操作成功后失效

## 渲染接入点

- `preview-directory.tsx` 的 name 列 cell：行尾追加 `<span class="dir-vcs-mark">M/U/D/数字</span>`
  （不新增表格列——列宽会挤其它信息；行尾槽位自然存在）
- 文件名变色：给 name span 加 `is-vcs-m/u/d` class（SCSS 用 `--warning/success/error-color`）
- 删除线：`is-vcs-d` 加 `text-decoration: line-through`
- 带标记的行加 `title`（悬停说明），`aria-hidden` 的 mark 由 name 的 title 承载语义

## 回滚

`FILES_VCS_TREE_STATUS_ENABLED` 常量置 false：不发 RPC、不加标记，回到纯目录视图。

## 验证

- 单测：`buildVcsTreeStatus`（纯函数）——M/U/D 解析、目录前缀聚合计数、独立仓库判定、
  噪音目录跳过、空 status、statuslimit 截断
- 真机 CDP：对**本项目仓库**（有真实 M/U 变更）打开目录视图，断言：
  1) 根目录行出现计数；2) 找一个 modified 文件名变橙 + 行尾 M；
  3) untracked 文件绿 + U；4) clean 文件无标记；5) 切换目录只发 1 次 RPC（计数器断言）
- 截图留证
