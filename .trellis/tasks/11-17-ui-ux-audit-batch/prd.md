# PRD — UI/UX 核心组件优化方案与原型落地（10 项）

## 背景

Snorkeling（WaveTerm fork）已交付多批功能（Overview 看板、Agent chip 收口、Files VCS 标记、
VCS history graph、CommonText 系列等），但 10 个核心组件/页面在交互一致性、信息层级、
可访问性与边界状态（溢出/空态/降级）上仍有可优化的空间。用户要求：找出 10 个核心功能
组件/页面，给出 UI/UX 优化方案，并落地为可交互原型 HTML。

## 范围（10 个组件）

| # | 组件 | 镜像源 |
|---|---|---|
| 1 | TabBar / Workspace Switcher | `frontend/app/tab/` |
| 2 | Block 头部 + 信息卡 + 最小化浮层 | `frontend/app/block/` |
| 3 | Overview 看板 + 时间线 | `frontend/app/session-overview/` |
| 4 | AI Sessions 列表 + 详情 | `frontend/app/view/aisessions/` |
| 5 | Agent 状态 chip / 悬浮卡 | `frontend/app/agent-status/` |
| 6 | Files 预览 + 目录树 VCS 标记 | `frontend/app/view/preview/`、`frontend/app/treeview/` |
| 7 | VCS diff / commits | `frontend/app/view/vcs*/` |
| 8 | WidgetsBar 右侧工具条 | `frontend/app/workspace/widgets.tsx` |
| 9 | 常用文本 CommonText | `frontend/app/commontext/` |
| 10 | Launcher 快速启动 + Settings 密度 | `frontend/app/view/launcher/`、`frontend/app/view/waveconfig/` |

## 需求

1. 每个组件给出：现状问题（≥3 条，可对应到真实代码/已知红灯）→ 优化方案（≥3 条，
   可验证）→ 可交互原型演示。
2. 原型视觉与真实产品一致：复用 `theme.scss` 的设计 token（暗/亮双主题、accent、
   header 30px、radius 8px、Inter/Hack 字体栈）。
3. 交付形式：`design/prototypes/ui-ux-audit-batch/`，含 1 个 hub 导航页 + 10 个单文件
   原型 HTML + 共享 token/style 资产 + README（状态标记 ▲ 设计活跃）。
4. 不改动任何 `frontend/` 生产代码；纯设计层交付。

## 非目标

- 不实现任何生产代码改动。
- 不做竞品级视觉重构；保持 Snorkeling 现有设计语言。
- 不覆盖 collab / onboarding（不在本次 10 项内）。

## 验收标准

- [ ] hub 页可导航到全部 10 个原型；每个原型可独立打开。
- [ ] 每个原型支持暗/亮主题切换，颜色取自 theme.scss 真实 token。
- [ ] 每个原型含「现状问题」清单 + 优化方案说明 + 至少一个可交互演示区。
- [ ] README 状态标记齐全，`__INDEX__.md` 与 `design/prototypes/README.md` 功能域表已登记。
- [ ] git 提交并推送（仅本次新增文件，不夹带工作区已有的 commontext 改动）。
