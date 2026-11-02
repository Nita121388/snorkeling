# PRD — Files Block 悬浮卡展示 Git 分支信息

## 需求来源

用户（nita）反馈：鼠标悬浮 Files（`view: preview`）Block 的 Tab / Sidebar 条目时弹出的信息卡，只显示
`Folder|File` + 路径，看不到这个目录/文件属于哪个 Git 仓库、在哪个分支、有没有未提交改动。
需要把「分支相关信息」补进这张卡。

## 现状（已核实）

- 悬浮卡入口统一走 `BlockInfoCard` 分派器（`frontend/app/block/block-info-card.tsx`），三个消费方：
  `blockframe-header.tsx`（Block 头部/Tab）、`block.tsx`（Inline Tab）、`block-sidebar.tsx`（左侧 Sidebar）。
- Files 类型 Block（`meta.view === "preview"`）分派到 `PreviewInfoCard`，目前仅渲染
  `InfoCardHead(图标 + Folder/File)` + `InfoCardPreview(完整路径)`。
- `useInfoCardHover`（`frontend/app/element/info-card/info-card-hover.tsx`）**没有显示延迟**：
  `mouseenter` 立即 `isOpen = true`，只有 200–300ms 的**隐藏**延迟。因此「悬停即请求」会在
  快速扫过 Tab 栏时打出一串 RPC。
- 后端已有现成命令 `remotevcsstat`（`pkg/wshrpc/wshremote/vcs.go:2229`），入参 `{path}`，
  内部 `detectGitRoot` 后返回 `branch / added / removed / files`，任意子路径可用。
  前端调用范例见 `frontend/app/view/aisessions/git-status-bar.tsx`（`makeConnRoute(connection)` 路由）。

## 需求（方案 B）

悬浮卡在路径区下方增加一个 Git 分区：

- 第一行 `Branch` → 分支名（等宽字体，detached 时显示 `detached@<shortsha>`）；
- 第二行 `Changes` → `+added −removed · Nf`（未提交行数 + 文件数）。

非 Git 仓库、RPC 失败、远端不支持时**整块不渲染**，卡片与今天逐像素一致。

## 性能红线（验收条件，硬性）

1. **快速划过 Tab 栏零请求**：`mouseenter` 后不足 150ms 就离开，不得发出任何 RPC。
2. **TreeView / 虚拟行不受影响**：本改动不得触及 `treeview.tsx` 的渲染路径。
3. **无轮询、无 watcher、无文件监听**：不得引入 `setInterval` 之外的周期性请求（本项目就是 0 个周期请求）。
4. **缓存命中零请求**：同一 `path + connection` 在 60s TTL 内重复悬停，0 次 RPC。
5. **并发去重**：同一 `path + connection` 在途请求最多 1 个（single-flight）。
6. **失败静默**：RPC 失败/超时（8s）只写负缓存，不 toast、不重试、不影响卡片其余内容。
7. **懒加载**：不在 Block 挂载时预取（打开 10 个 preview block 不得产生 10 次 RPC）。

## 验收标准

1. 悬浮一个位于 git 仓库内的 Files Block → 卡片出现 `Branch` / `Changes` 两行，值与 `git status` 一致。
2. 悬浮 `E:/tmp` 这类非仓库路径 → 无 Git 分区，卡片其余部分与改动前一致。
3. 快速划过 10 个 Tab/Block → 网络面板 0 次 `remotevcsstat`。
4. 同一卡片反复悬停（<60s）→ 仅 1 次 RPC。
5. 远端 SSH connection 的 Files Block → 走同一路由查询；失败时静默降级。
6. `PreviewInfoCard` 分派契约不变（`block-info-card.test.tsx` 全绿）。
7. 新增单测覆盖：缓存命中 / 负缓存 / TTL 过期 / single-flight 去重 / 非仓库归一化。
8. `tsc --noEmit` 无新增错误；`eslint` 对改动文件通过。

## 约束

- **后端零改动**：不加 `ahead/behind`、不改 `RemoteVcsStatRtnData`（避免动 RPC 契约与生成类型）。
- 不改 `block.tsx` / `blockframe-header.tsx` / `block-sidebar.tsx`：卡片壳与三处调用点不动。
- 不新建第二套卡片样式：`RepoLine` 独立成纯展示组件，便于将来 Files 树悬浮卡复用。
- `buildFileMetaRows` 等既有纯函数保持原样，现有单测不受影响。
