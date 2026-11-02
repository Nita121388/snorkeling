# Implement — Files Block 悬浮卡 Git 分区

## 改动清单（顺序即执行顺序）

1. [x] `frontend/app/block/use-repo-info.ts`（新增）
   - `RepoInfo` 类型、`normalizeRepoInfo`、`repoInfoCacheKey`
   - `readRepoInfoCache` / `clearRepoInfoCache`（测试用）
   - `fetchRepoInfo(path, connection, fetcher?)`：single-flight + 缓存写入
   - `useRepoInfo(path, connection)`：缓存同步命中 → 否则 150ms 延迟后取
   - 常量：`REPO_INFO_TTL_MS=60000` / `REPO_INFO_DELAY_MS=150` / `REPO_INFO_TIMEOUT_MS=8000`

2. [x] `frontend/app/block/repo-line.tsx`（新增）
   - `<RepoLine path connection />`：`useRepoInfo` → `info == null` 返回 `null`
   - 两行 label/value，Tailwind 样式与 `treeview-file-tooltip.tsx` 同款
   - `React.memo`

3. [x] `frontend/app/block/block-info-card.tsx`（改）
   - `PreviewInfoCard` 内从 `meta.file || meta.url` 取 path、`meta.connection` 取 connection
   - 在路径区之后挂 `<RepoLine path={path} connection={connection} />`
   - 不加任何 hook 到 `PreviewInfoCard` 本体

4. [x] `frontend/app/block/use-repo-info.test.ts`（新增，jsdom 不需要）
   - 缓存命中 → fetcher 调用次数 0
   - 非仓库（branch 空 / error）→ `normalizeRepoInfo` 返回 null 且写负缓存
   - TTL 过期 → 重新 fetch（用 `vi.setSystemTime` / fake timers）
   - single-flight → 同一 key 并发两次只调 fetcher 1 次
   - fetcher 抛错 → 负缓存，不抛出

5. [x] `frontend/app/block/repo-line.test.tsx`（新增，jsdom）
   - `RepoLine` 在 info 为 null 时渲染 `null`
   - 给定 info 渲染分支名与 `+a −r · Nf`

## 校验命令

```bash
# 目标单测（快）
npx vitest run frontend/app/block/use-repo-info.test.ts frontend/app/block/repo-line.test.tsx \
  frontend/app/block/block-info-card.test.tsx frontend/app/treeview/treeview-file-tooltip.test.ts

# 类型检查（慢，>60s 用 async 子代理跑）
npx tsc --noEmit -p tsconfig.json

# lint（改动文件）
npx eslint frontend/app/block/use-repo-info.ts frontend/app/block/repo-line.tsx \
  frontend/app/block/block-info-card.tsx
```

## 回归门

- `block-info-card.test.tsx` 分派契约不变（Preview → PreviewInfoCard）。
- 非 Git 路径卡片与改动前视觉一致（分区直接不渲染）。
- 快速划过 Tab 栏 0 次 `remotevcsstat`（人工在 dev + 网络面板确认，或看项目 RPC 日志）。

## 回滚点

单 commit 可整体回退；`PreviewInfoCard` 的改动只是一个新增子元素，删除 `RepoLine` 挂载即回到旧行为。
