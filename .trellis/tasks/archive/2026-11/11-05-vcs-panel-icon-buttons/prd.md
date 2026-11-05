# VCS 面板文字按钮图标化（17 处）

## Goal

把版本管理（Version Control）面板里 17 处「纯文字 + 下划线」动作按钮收敛为图标按钮，
让面板的可点击面变成「图标 + tooltip」的安静风格；仅保留一处主 CTA（Commit）、页码、
段头标题与导航 Tab 的文字。

## 背景

VCS 面板 5 个 tab 文件里堆了大量 `text-[11px] text-accent hover:underline` 的文字按钮
（Diff / History / Select All / Select None / Reset / Apply / Prev / Next / Refresh /
View Diff / Update / Pull / Create & Switch / Yes / No …）。它们在列表行里常驻，
把行高和视线都撑坏了，也和面板其它地方的 iconbutton 风格不一致。

## Requirements

### R1 动作按钮图标化（17 处）

| # | 位置 | 现状 | 目标图标 | 备注 |
|---|---|---|---|---|
| 1 | `vcs-tabs.tsx` 仓库头 | `Pull` / `Pulling…` | `fa-arrow-down-to-line` | 运行中换 spinner |
| 2 | `vcs-changes-tab` 文件行 | `Diff` | `fa-code-compare` | hover 浮现 |
| 3 | `vcs-changes-tab` 文件行 | `History` | `fa-clock-rotate-left` | hover 浮现 |
| 4-7 | Changes / Untracked 段头 | `Select All` ×2 / `Select None` ×2 | `fa-square-check` / `fa-square` | 一对 icon-button |
| 8 | Remote 段头 | `Update` | `fa-arrow-down` | 运行中 spinner |
| 9 | 筛选条 | `Reset` | `fa-rotate-left` | |
| 12 | `vcs-branches-tab` | `Refresh`（文字壳包图标） | 标准 icon-button | 统一壳 |
| 13 | `vcs-branches-tab` | `Create & Switch` | `fa-plus` | tooltip 说明 |
| 14 | `vcs-branches-tab` 删除确认 | `Yes` / `No` | `fa-check` / `fa-xmark` | danger 色，保留二次确认 |
| 15 | `vcs-history-tab` | `Apply` / `Reset` | `fa-check` / `fa-rotate-left` | 回车已可触发 Apply |
| 16 | `vcs-history-tab` 文件行 | `View Diff` | `fa-code-compare` | hover 浮现 |
| 17 | `vcs-history-tab` 分页 | `Prev` / `Next` | `fa-chevron-left` / `fa-chevron-right` | 页码 `1 / 5` 保留 |
| 18 | `vcs-pipelines-tab` | `Refresh` | `fa-arrows-rotate` | |

### R2 保留文字的部分

- `Commit (N)` —— 唯一主 CTA，保留文字，加 `fa-code-commit` 前缀图标。
- 分页页码（`1 / 5`）、段头标题（Changes / Untracked / Remote）、仓库 chips、
  导航 Tab（Changes / Branches / Pipelines / History）。
- 删除 `supports multi-select` 说明文字（无信息量）。

### R3 复用组件

新增 `frontend/app/view/vcs/vcs-icon-button.tsx`，导出 `VcsIconButton`：
props `icon / title / onClick / disabled / tone(normal|accent|danger) / loading / size(sm|md)`。
内部统一处理 `title` + `aria-label`、hover / disabled 态、loading spinner。

### R4 可达性

- 每个 icon-only 按钮必须同时有非空 `title` 与 `aria-label`。
- 行内动作按钮用 `opacity-0 group-hover:opacity-100` **加** `focus-visible:opacity-100`，
  键盘 Tab 必须能看到。

### R5 并行开发约束（硬约束）

- 只允许改 `frontend/app/view/vcs/**`，外加新增 `vcs-icon-button.tsx` 与本任务目录。
- **禁止**改全局 `*.scss`、tailwind 配置、`frontend/app/element/**` 共享组件
  —— 当前有多个并行 worktree 在改这些区域（i18n / onboarding / modal-focus / block-editor）。
- **禁止**新增 i18n key（有 `worktree-i18n-snorkeling` 在并行）。aria-label 沿用现状硬编码英文。

## Acceptance Criteria

- [ ] 面板内不再存在「有可见文字且不在白名单」的 button：`Commit` / 页码除外。
- [ ] 所有 icon-only button 的 `aria-label` 非空。
- [ ] 列表行 `Diff / History / View Diff` 默认不可见，行 hover 或键盘 focus 时可见。
- [ ] 每处 icon-only 按钮都有 `title` tooltip，文案与原文字按钮语义一致。
- [ ] `npx tsc --noEmit -p tsconfig.json` 错误数不超过既有基线（69）。
- [ ] 新增验证台 `scripts/verify/vcs-panel-buttons/verify.mjs` 全绿，结论入
      `docs/project/verify-ledger.md`。
