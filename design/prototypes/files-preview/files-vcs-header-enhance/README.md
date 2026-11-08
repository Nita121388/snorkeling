# Files Block Header · 版本管理增强原型

> 状态：**设计中（待确认）**，真实代码未改动
> 镜像源：`frontend/app/view/preview/preview-model.tsx`、`frontend/app/block/block.scss`、`frontend/app/view/vcs/vcs.tsx`、`frontend/app/view/preview/preview-directory-utils.tsx`

## 需求

1. **从 Files Header 跳转到仓库网页**：目前在 VCS Block 里右键仓库才有 `Open Remote Repository`。希望从 Files Header 的版本管理图标（`code-branch`）也能直接跳。
2. **仓库干净时一眼看出**：Files Header 的路径文字变色（外加"变动大小"的感觉），且必须实时准确。

## v2 相对 v1 修掉的实质问题

| # | v1 问题 | v2 处理 |
|---|---|---|
| 1 | 用了 `--text-secondary`，**该变量在主题里不存在** | 改用真实变量 `--secondary-text-color` |
| 2 | accent 假设成蓝色 | 真实 `theme.scss` 里 `--accent-color: rgb(88, 193, 66)` **是绿色**，正好契合「干净」语义 |
| 3 | 右键菜单把 `Open VCS Block` 做成 disabled 项 | 移除该噪音项（左键本来就是它），菜单只留真实可用操作 |
| 4 | 点菜单没有反馈，看不出「跳转」 | 点击后弹 toast 模拟真实结果 |
| 5 | 没有并排对比，不够「一眼看出」 | 增加 Clean / Dirty / Hover 三态并排对照区 |
| 6 | 干净态只在路径上体现，路径被截断就看不见 | 版本管理图标加 5px 绿点做冗余强化 |

## 设计决策

### A. 跳转仓库网页
- **左键 / Ctrl+Cmd+Click**：保持现有行为（打开 VCS Block / 新建 VCS Block），**完全不变**
- **右键图标**：菜单只含
  - `Open Remote Repository`（优先 `browseurl`，fallback `remoteurl`，都无则禁用）
  - `Copy Remote URL`
  - `Copy Repository Path`
- 跳转统一走 `openLink()`（`@/store/global`），与 VCS Block 内行为一致

### B. 干净态路径样式
```scss
.preview-filename.vcs-clean:not(:hover) {
    color: color-mix(in srgb, var(--accent-color) 45%, var(--secondary-text-color));
    font-weight: 500;
    letter-spacing: 0.01em;
    transform: scale(1.012);
    transform-origin: left center;
    display: inline-block;
}
```

- **颜色**：accent 45% 混 secondary。保留灰调，不会像纯绿那样像「新增成功」
- **「变动大小」**：`font-weight: 500` + `transform: scale(1.012)`。**零布局影响**，不会挤压右侧图标、不会提前截断（真正改 `font-size` 会）
- **不打架**：`:not(:hover)` 限定 + `:hover` 明确还原 `color: var(--main-text-color)` / `font-weight: 400` / `scale(1)`。只改 color/weight/transform，不碰 background/border
- **Dirty 完全不变**：有变更时路径保持默认，零视觉噪音

### C. 实时准确性
- 判定：`repotype === "git"` 且 `status` 既无变更项也无 untracked ⇒ clean
- 数据源：复用 VCS 仓库状态缓存（VCS Block 与 Files Header 共用），不各自重复请求
- 刷新触发：VCS 操作（commit/pull/push/fetch/update/refresh）后、目录切换、窗口聚焦
- 多仓库：路径最长前缀匹配归属仓库

## 落地要点（实现阶段）

1. `frontend/app/store/vcs-repo-cache.ts`（新增）：`(connection, repoRoot) -> { repo, status, lastUpdated }`，VCS Block 写入、Files Header 读取
2. `preview-model.tsx`：
   - `endIconButtons` 的 `vcsButton` 加 `contextmenu`
   - `viewText` 的 `.preview-filename` 按 clean 状态加 `vcs-clean`
3. `block.scss`：在 `.block-frame-div.preview-filename-shell` 作用域内加上述样式（不要放文件顶层）
4. 自检：clean 判定（有变更 / 有 untracked / 非 git / 无仓库）各一条断言测试

## 原型
打开 `index.html`：
- 顶部切换 **干净 / 有变更** 与 **有无远端**
- **右键** 版本管理图标看菜单，点菜单项有 toast 反馈
- 下方三态并排对比：Clean / Dirty / Hover
- 鼠标悬浮路径可感受「还原回正常交互」
