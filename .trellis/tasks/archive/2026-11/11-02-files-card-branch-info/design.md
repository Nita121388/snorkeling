# Design — Files Block 悬浮卡 Git 分区

## 1. 组件边界

```
blockframe-header.tsx / block.tsx / block-sidebar.tsx      ← 零改动
        │  BlockInfoCard({ blockId, blockData })
        ▼
block-info-card.tsx  PreviewInfoCard                       ← 唯一改动点：挂 <RepoLine>
        │  path = meta.file | meta.url,  connection = meta.connection
        ▼
block/repo-line.tsx  <RepoLine path connection />           ← 新增：纯展示 + 延迟 + 订阅
        │
        ▼
block/use-repo-info.ts  useRepoInfo(path, connection)       ← 新增：延迟 / 缓存 / single-flight
        │
        ▼
RpcApi.RemoteVcsStatCommand(TabRpcClient, { path }, { route, timeout })
```

关键：RPC 状态**只存在于 `RepoLine` 子树**。`PreviewInfoCard` 本身不持有任何 hook 状态，
`BlockInfoCard` 的三处调用方不会因分支数据变化而 re-render。

## 2. 数据契约

```ts
export type RepoInfo = {
    branch: string;   // "main" | "detached@1a2b3c4"
    added: number;    // 未提交新增行
    removed: number;  // 未提交删除行
    files: number;    // 变更文件数
};
```

`normalizeRepoInfo(rtn: RemoteVcsStatRtnData | null): RepoInfo | null`
- `rtn == null` / `rtn.error` 非空 / `branch` 为空 → `null`（= 不在仓库内，整块不渲染）
- 否则取 `branch` / `added` / `removed` / `files`，数字缺失按 0。

## 3. 缓存与请求纪律

```
cache:    Map<key, { info: RepoInfo|null; at: number }>     模块级，app 生命周期
key:      `${connection}\u0000${path}`
TTL:      60_000ms（正负缓存同 TTL，负缓存避免失败风暴）
inflight: Map<key, Promise<RepoInfo|null>>                  single-flight
delay:    150ms（悬停停留阈值，未到期不发请求）
timeout:  8_000ms
```

- TTL 到期**不主动刷新**，只在下一次悬停时重新取。
- 正向命中：同步返回，0 异步、0 请求。
- 负向命中（TTL 内已知不在仓库）：同样 0 请求，直接不渲染。
- 卸载/换路径：`clearTimeout` + `cancelled` 标记，迟到的响应只写缓存、不 setState。

### 取舍：缓存 key 为什么不是 gitRoot

`RemoteVcsStatRtnData` 不返回 `repopath`，前端算不出仓库根。选择按 `path` 缓存：
同一 Block 反复悬停 0 请求；不同 Block 各自 1 次。代价可接受（Block 数量级 = 个位数，
且 `git-status-bar` 本就每 5s 一次同命令）。若将来要按仓库归并，只需后端补一个
`repopath` 字段——本设计不阻塞。

## 4. 时间线

```
t=0ms      mouseenter → 卡片立开（沿用 useInfoCardHover，不加显示延迟）
           RepoLine 挂载 → 查缓存
             ├─ 命中 → 同步 setInfo，卡片一次成形（0 请求）
             └─ 未命中 → 起 150ms 定时器，返回 null（不渲染分区）
t<150ms    mouseleave → 卸载 → 定时器取消（0 请求）★ 快速划过的常见路径
t=150ms    仍停留 → fetchRepoInfo（single-flight）→ setInfo → 分区出现
t>150ms    卸载 → cancelled=true，晚到响应仍写缓存（下次悬停直接命中）
```

## 5. 视觉与状态

```
┌───────────────────────────────────┐
│ 📁  Folder                        │
│ ┌───────────────────────────────┐ │
│ │ E:/code/snorkeling/design     │ │
│ └───────────────────────────────┘ │
├───────────────────────────────────┤   ← border-top 分隔线
│ BRANCH                     main   │   ← 10px 大写弱化标签 + 12px 等宽值
│ CHANGES              +42 −7 · 5f  │
└───────────────────────────────────┘
```

- `pending` 不占位、不显骨架（本地 RPC 通常 <50ms；占位反而在非仓库场景留空行）。
  代价是分区「长出来」约 2 行高；卡片是 absolute portal，不影响周围布局。
- 颜色 tokens：`added` 用 `text-success`/绿色系变量，`removed` 用 `text-error`/红色系变量，
  其余沿用 `text-secondary/70`（标签）与 `text-foreground`（值），与 Files 树悬浮卡同款。
- 分支名 `font-mono` + `truncate`，超长分支（`feat/xxx-yyy-zzz`）不撑破 `max-width: 400px`。

## 6. 状态矩阵

| 场景 | 分区 | 备注 |
|---|---|---|
| git 仓库，有分支 | Branch + Changes | 正常 |
| detached HEAD | `detached@1a2b3c4` | 后端已归一化 |
| 零改动 | Branch + `+0 −0 · 0f` | 仍然显示（0f 是有用信息） |
| 非 git 目录 | 不渲染 | `fileName`/路径区不变 |
| RPC 失败 / 超时 | 不渲染 | 写负缓存 60s |
| `meta.file` 为空 | 不渲染 | 直接短路 |

## 7. 复用

`RepoLine` 是纯展示（props: `{ info }`），`useRepoInfo` 是独立 hook。
将来 `treeview-file-tooltip.tsx` 加分支行时直接组合两者，不复制样式与请求逻辑。

## 8. 风险

- 远端 connection 若 wsh 版本过旧不支持 `remotevcsstat` → 命令失败 → 负缓存 → 静默降级（符合红线 6）。
- `TabRpcClient` 在无 tab 上下文（测试/SSR）不可用 → 只在真实渲染路径调用，单测直接测纯函数与 fake fetcher。
