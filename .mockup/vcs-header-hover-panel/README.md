# Files Block Header — VCS 图标 Hover 快捷面板

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/preview/preview-model.tsx, frontend/app/element/iconbutton.tsx, frontend/app/block/blockframe-header.tsx, frontend/app/block/block.scss, frontend/app/view/preview/preview-directory-utils.tsx, frontend/app/view/vcs/vcs.tsx
> 最后同步：2026-08-22

## 需求

Files Block header 上的版本管理图标（`code-branch`，title "Version Control"）支持鼠标悬浮时弹出快捷面板，内容按仓库类型（Git / SVN）区分；点击图标本体行为不变（打开完整 VCS Block）。

## 原型内容

打开 `index.html`，通过顶部场景 chips 切换 8 个场景：

| 场景 | 演示 |
| --- | --- |
| Git · 目录 / Git · 文件 | 分支名 + 改动/未跟踪 + ↓落后↑领先 pill；Pull/Push 按 behind/ahead 置灰；文件 block 多 Diff 按钮 |
| SVN · 目录 / SVN · 文件 | 无分支行；远端变更文件数替代 ahead/behind；同步动作只有 Update；历史入口叫 Log |
| 多仓库（嵌套） | includeparent 返回多个 repo，面板分组列出、各自按钮 |
| 非 repo 路径 | 不弹面板，保留原生 title；点击仍打开完整 VCS Block |
| 检测中（懒加载） | 首次 hover 显示 Detecting...，800ms 后原地更新为就绪面板 |
| 解析失败 | Resolve Failed + Copy Debug Info（与右键菜单降级一致） |

交互时序对齐真实 `Tooltip` 组件：hover 350ms 延迟弹开、移开 250ms 宽限收起。sync 按钮 click 后模拟 1.5s 执行并刷新计数（模拟清缓存 + refresh）。

## 文案语言约束

应用尚未支持多语言（no i18n），所有模拟应用内 UI 的文案均为**英文**，与现有 VCS 视图措辞对齐：`N changed / N untracked`、`↓ Behind N / ↑ Ahead N`、`No remote changes`、`Detecting...`、`Resolve Failed` 等。原型中的中文仅出现在评审注释（页面底部说明区、代码注释），不会出现在面板/按钮/toast 等应用 UI 位置。

## 结构镜像对照

| 原型元素 | 镜像真实源 | 说明 |
| --- | --- | --- |
| `.block-frame-header` / `.block-frame-textelems-wrapper` / `.block-frame-text` | `frontend/app/block/blockframe-header.tsx` HeaderTextElems ~L195 | header 左侧路径文本区 |
| `.block-frame-end-icons.is-hovered` | `blockframe-header.tsx` HeaderEndIcons ~L240 + `block.scss` `.block-frame-end-icons` | 右侧图标条，hover 才显示 |
| `.wave-iconbutton.block-frame-header-iconbutton` | `frontend/app/element/iconbutton.tsx` IconButton | eye/refresh 为既有按钮占位对照 |
| **新增** `.vcs-hover-anchor` 包裹 vcsButton | `preview-model.tsx` endIconButtons 中 vcsButton（icon `code-branch`, title "Version Control"）~L817 | 真实实现 = 给 `IconButtonDecl` 加可选 `tooltipNode`，IconButton 内外包 `<Tooltip>`（与 `HeaderText.tooltipNode` 同模式） |
| **新增** `.vcs-hover-panel` flyout 卡片 | 新组件（floating-ui Tooltip 卡片，flip+shift 防溢出） | 面板数据来自 `resolveRepoForPath`（statuslimit 50）+ `directoryVcsResolveCache` 共享缓存 |
| `.vhp-badge` GIT/SVN | `preview-directory-utils.tsx` `getSupportedRepoType` / `makeRepoMenuLabel` | 与右键菜单同源的类型判定 |
| Pull/Push/Fetch vs Update | `makeRepoSyncLabel`（Git→Pull，SVN→Update）、`RemoteVcsSyncCommand` | disabled 条件：Git behind/ahead=0；SVN Update 恒可用 |
| Commits vs Log | `openCommitsBlock`（标题按 repotype 区分） | History → `openHistoryBlock`；Diff → `openDiffBlock`（仅文件 block） |
| Open VCS Block | `openVersionControlBlock()`（点击图标本体）/ `openVcsBlock` | 兜底入口始终可用 |
| sync 成功后刷新 | `directoryVcsResolveCache` 清条目 + `model.refresh()` | 失败走 `setErrorMsg` 通道 |

## 数据来源（后端已确认）

`RemoteVcsRepositoriesCommand` 无论 statuslimit 取值多少都返回 branch + remote（git: ahead/behind；svn: files），因此轻量调用（statuslimit 50，避免 svn remote files 计数被截断）即可支撑面板全部信息。

## 落地要点（实现阶段）

1. `custom.d.ts`：`IconButtonDecl` 增加可选 `tooltipNode?: React.ReactNode`。
2. `iconbutton.tsx`：有 `tooltipNode` 时外包 `<Tooltip placement="bottom">`。
3. `preview-model.tsx`：vcsButton 挂面板 ReactNode；hover 触发懒加载 resolve。
4. `preview-directory-utils.tsx`：导出 `resolveRepoForPath` / cache / sync / open* 动作复用（不抽新模块）。
5. 自检：面板动作生成逻辑（git/svn 区分、disabled 条件、file/directory Diff 有无）加 assert 式测试。
