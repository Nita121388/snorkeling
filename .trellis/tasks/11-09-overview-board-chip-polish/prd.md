# Overview 看板 chip 美化（A：去描边 · 胶囊化）

## Goal

`frontend/app/session-overview/session-overview.scss` 里的 `.session-overview-board-chip`
（provider / 项目 chip，如 `title="Obsidian"` 那颗）观感偏旧：1px 实描边 + 9px 字号 + 5px 直角圆角，
与同文件 `is-tag` 变体（无描边浅底）不一致。按 nita 选定的 **A 方向**做一次纯 CSS 微调：

> 去描边、胶囊圆角、字号 9→10px、文字提亮一档、内距水平收成 `8px`。
> 不改 DOM、不改 TSX、不改 tag / tag-more / 状态 chip 的语义与位置。

## 背景

2026-11-09 nita：`<span class="session-overview-board-chip" title="Obsidian">Obsidian</span>`
这个样式可以美化。当前规则（`session-overview.scss:1749`）：

| 属性 | 今天 | A 方案 |
|---|---|---|
| `padding` | `1px 6px` | `1px 8px`（水平 +2px；**竖向不动**，见下） |
| `border` | `1px solid var(--border-color)` | `1px solid transparent`（去描边但保留盒子尺寸） |
| `border-radius` | `5px` | `999px`（胶囊） |
| `background` | `rgb(from var(--main-text-color) r g b / 0.035)` | 不变 |
| `color` | `var(--secondary-text-color)` | `rgb(from var(--main-text-color) r g b / 0.78)` |
| `font-size` | `9px` | `10px` |
| `line-height` | `1.4` | `1.25`（抵掉字号 +1px，总高几乎不变） |
| `max-width` / `font-weight` / 省略 | `120px` / `600` / ellipsis | 不变 |

**为什么竖向 padding 不动**：本仓已有硬原则「卡高不因 meta 行变化而漂」（`11-09-overview-card-metrics` 的
R5 与度量轨实现都遵守）。竖向 `1px` + `line-height 1.25` 让 chip 总高与今天持平（≈16.5px vs 16.6px），
避免卡片高度漂移和 220px 窄列换行。

`is-tag`（1766 行）/ `is-tag-more`（1776 行）只做继承层覆盖，不改：
`is-tag` 仍是无描边浅底 + `opacity .82`；`is-tag-more` 仍是透明无底。两者显式写了
`border-color: transparent`，在 base 去描边后只是冗余，不产生观感变化。

## 做什么

1. 只改 `session-overview.scss` 的 `.session-overview-board-chip` 一个块（上表 5 个属性）。
2. 交付一个可交互原型 `design/prototypes/overview-dashboard/board-chip-polish/index.html`：
   before/after 一键切换、暗/亮/单色三主题、真实 chip 结构（`session-overview-board-card-meta`
   下的 provider chip / tag chip / tag-more / 状态 chip），让 nita 不重启应用也能对照。
3. 更新 `design/prototypes/__INDEX__.md` 导航清单。

## 验收标准（命令 → 数字）

1. 红证（改 CSS 前先跑）：探针断言「chip 已是 A 形态」→ 修复前必须红。
   `node -e "...border-radius: 999px...font-size: 10px..."` → 修复前 `exit 1`，输出 `CHIP_A_OLD=1`；
   落盘 `loop/red/N-1109-overview-board-chip-polish.txt`。
2. `npx vitest run frontend/app/session-overview --reporter=dot > nul 2>&1 && echo CHIP_SUITE=1` → `CHIP_SUITE=1`
   （CSS 改动不得打破现有 194 用例）。
3. `git grep -c "padding: 1px 8px" -- frontend/app/session-overview/session-overview.scss`
   → `1`（A 形态已落地）。
4. `git grep -c "board-chip-polish" -- design/prototypes/__INDEX__.md`
   → `1`（原型已进导航）。
5. 本包只改 `.session-overview-board-chip` 一个块；同文件另有 `11-09-overview-card-metrics` 的未提交 hunk，
   不属本包，提交时按 hunk 分开。
6. 【用户自验】nita 看原型 / 自己的应用确认观感；本包不启动 Electron/CDP。

## 不做

- 不做 B 方向（provider accent 色点 / 左侧色条），不动 TSX。
- 不改 `is-tag` / `is-tag-more` / `AgentStatusChip` 的规则。
- 不改 `session-overview.tsx`、`overview-board.tsx`、DOM 结构与 chip 文案。
- 不启动 Electron/CDP（nita 明示「我自己验证」）。

## touch 白名单

`frontend/app/session-overview/session-overview.scss` ·
`design/prototypes/overview-dashboard/board-chip-polish/**` ·
`design/prototypes/__INDEX__.md` ·
`.trellis/tasks/11-09-overview-board-chip-polish/**` ·
`loop/items/N-1109-overview-board-chip-polish.md` ·
`loop/red/N-1109-overview-board-chip-polish.txt` ·
`loop/gates.json`（引擎写） · `loop/LEDGER-2026-11.jsonl`（引擎写）

## 回滚

`git checkout -- frontend/app/session-overview/session-overview.scss` 即恢复；原型目录可整目录删除。
