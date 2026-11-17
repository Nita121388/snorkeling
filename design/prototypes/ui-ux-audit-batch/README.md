# ui-ux-audit-batch — 核心组件 UI/UX 优化批次

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/tab, frontend/app/block, frontend/app/session-overview, frontend/app/view/aisessions, frontend/app/agent-status, frontend/app/view/preview, frontend/app/treeview, frontend/app/view/vcs, frontend/app/view/vcsdiff, frontend/app/view/vcshistory, frontend/app/workspace/widgets.tsx, frontend/app/commontext, frontend/app/view/launcher, frontend/app/view/waveconfig
> 最后同步：2026-11-17

## 这是什么

跨功能域的 UI/UX 审计批次：一次挑出 10 个核心功能组件/页面，每项给出
「现状问题（P1..Pn，对应真实代码/已知红灯）→ 优化方案（S1..Sn，可判定规则）→
可交互原型（暗/亮双主题）」。设计 token 镜像 `frontend/app/theme.scss`，
原型视觉与产品一致。

对应任务：`.trellis/tasks/11-17-ui-ux-audit-batch/`（prd/design/implement 三件套齐全）。

## 为什么是独立目录（而不是放进各功能域）

本批次是**跨 10 个功能域的横向审计**，需要统一入口与统一的问题→方案结构；
按 `DESIGN-GOVERNANCE.md` 的精神作为例外登记在这里（`__INDEX__.md` 与
`design/prototypes/README.md` 均已登记）。单项方案成熟后，应把对应原型
**复制/迁移到功能域目录**并更新状态，本目录的对应项标记 ◐/●。

## 入口

| 文件 | 组件 | 一句话方案 |
|---|---|---|
| `index.html` | Hub | 批次导航 |
| `01-tabbar.html` | TabBar / Workspace Switcher | 三段式布局 · active 保护 + 溢出计数 · 信息卡视口翻转（N-1105） |
| `02-block-header.html` | Block 头部 / 信息卡 / 最小化 | 图标「3+更多」· 命中层修复（xterm link-layer）· 左侧最小化列 |
| `03-overview-board.html` | Overview 看板/时间线 | 空列收窄 rail · 卡片三级信息 · 仅看未完成 · 视图记忆 |
| `04-aisessions.html` | AI Sessions | 行三级信息 · 筛选 chip 化 · 骨架屏 · outline rail + 回底 FAB |
| `05-agent-card.html` | Agent chip / 悬浮卡 | 三密度 chip · 色盲可辨编码（脉冲/实心/斜纹）· 命中层 · runtime 统一 |
| `06-files-preview.html` | Files / 目录树 VCS | breadcrumb 可点 · 6px 方点 + tooltip · 只看改动 · 空态三件套 |
| `07-vcs-diff.html` | VCS diff / commits | 未变更折叠 · 双列行号 · 祖先链高亮 · sticky 工具栏 |
| `08-widgets-bar.html` | WidgetsBar | 28px 热区 · flyout 名称 · 3px active 指示 · 8px 折叠感温边 |
| `09-commontext.html` | CommonText | 置顶 + 使用元信息 · ⌘K 即滤 · 属性两列 · 标签 chip · 后台发送 toast |
| `10-launcher-settings.html` | Launcher / Settings | 三列启动面板 · 键盘图例 · 密度三档 · 脏状态条 |

## 使用

浏览器直接打开 `index.html`（file:// 可用，零依赖）。右上角切换暗/亮主题。
每页结构固定：现状问题 → 优化方案 → 交互演示（LIVE）→ 规格条（虚线框，
实现阶段可直接引用的尺寸/行为规则）。

## 资产

- `assets/proto.css` — 共享 token（暗/亮两套，镜像 theme.scss）+ 原型 shell 样式
- `assets/proto.js` — 主题切换（localStorage 持久化）、分段控件、开关、通用交互

## 状态

▲ 设计活跃：全部 10 项均为方案 + 原型，**尚未进入任何 `frontend/` 实现**。
落地顺序建议：05（Agent chip 命中层，与 02 同源，修复已知红灯 25/26）→
02 → 01（N-1105）→ 其余按 backlog 排。
