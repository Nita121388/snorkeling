# Files Block 悬浮卡：Git 分支分区（实现事实）

> 任务：`.trellis/tasks/11-02-files-card-branch-info`
> 最后更新：2026-11-02

## 结论一句话

`PreviewInfoCard`（`view: preview` 的 Block 悬浮卡）在路径下方多了一段 Git 分区：
当前分支 + 未提交变更（`+added −removed · Nf`）。非仓库路径下该分区不渲染，卡片与改动前一致。

## 文件

| 文件 | 作用 |
|---|---|
| `frontend/app/block/use-repo-info.ts` | 延迟 / 缓存 / single-flight / 归一化（`remotevcsstat`） |
| `frontend/app/block/repo-line.tsx` | 纯展示组件 `<RepoLine path connection />` |
| `frontend/app/block/block-info-card.tsx` | `PreviewInfoCard` 内挂 `<RepoLine>`（唯一改动点） |
| `frontend/app/block/use-repo-info.test.ts` | 缓存 / TTL / 负缓存 / 并发去重 / 抛错降级 |
| `frontend/app/block/repo-line.test.tsx` | 展示文本 + 缓存命中渲染 + 阈值前不渲染 |

## 数据来源

复用后端已有命令 `remotevcsstat`（`pkg/wshrpc/wshremote/vcs.go` → `RemoteVcsStatCommand`），
入参 `{path}`，内部 `detectGitRoot(path)`，任意子路径可用。**后端零改动。**

调用方式与 `frontend/app/view/aisessions/git-status-bar.tsx` 一致：
`RpcApi.RemoteVcsStatCommand(TabRpcClient, { path }, { route: makeConnRoute(connection), timeout: 8000 })`。

## 性能契约（改动时必须保持）

1. 悬停停留 **150ms** 才发第一次请求（`useInfoCardHover` 只有隐藏延迟，没有显示延迟，
   所以延迟写在 `useRepoInfo` 里）。快速划过 Tab 栏 = 0 请求。
2. **不预取**：Block 挂载时不请求。
3. 缓存 `Map<connection\0path, {info, at}>`，TTL **60s**，正负缓存同 TTL；命中 0 请求。
4. `single-flight`：同一 key 在途请求最多 1 个。
5. 失败 / 超时 / `error` 字段 → 负缓存（`info = null`），**不 toast、不重试**。
6. RPC 状态只存在于 `RepoLine` 子树；`BlockInfoCard` 的三处调用方不会因此 re-render。

## 已知取舍

- 缓存按 **path** 而不是 gitRoot：`RemoteVcsStatRtnData` 不返回 `repopath`，前端算不出仓库根。
  代价是「不同 Block 各自一次请求」，换来后端零改动。将来后端补 `repopath` 只需改 `repoInfoCacheKey`。
- 无 ahead/behind（`↑2 ↓0`）：需要后端扩返回值，本版本刻意不做。

## 后续复用

`treeview-file-tooltip.tsx`（Files 目录树节点悬浮卡）若要显示分支，直接组合
`useRepoInfo` + `RepoLine`，不要复制请求逻辑或另起一套样式。
