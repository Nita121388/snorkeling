> 同步状态：◐ 部分落地（2026-11-09：CSS 已写入 `session-overview.scss`，观感待 nita 验收）
> 镜像源：frontend/app/session-overview/session-overview.scss, frontend/app/session-overview/overview-board.tsx
> 最后同步：2026-11-09

# Overview 看板 chip 美化 · A 方案（去描边 · 胶囊化）

目标节点：`.session-overview-board-chip` —— 看板卡 meta 行里的 provider / 项目 chip
（真机例子：`<span class="session-overview-board-chip" title="Obsidian">Obsidian</span>`）。

打开方式：直接浏览器打开 `index.html`（零依赖）。可切 **暗 / 亮 / 单色** 三主题、
**并排 / 仅 BEFORE / 仅 AFTER** 三视图；页面顶部会实时量出 `Obsidian` chip 的 `宽 × 高`。

## 改了什么（A 方案）

| 属性 | BEFORE（今天） | AFTER（A） |
|---|---|---|
| `padding` | `1px 6px` | `1px 8px` |
| `border` | `1px solid var(--border-color)` | `1px solid transparent`（去描边、保留盒子尺寸） |
| `border-radius` | `5px` | `999px`（胶囊） |
| `color` | `var(--secondary-text-color)` | `rgb(from var(--main-text-color) r g b / 0.78)` |
| `font-size` | `9px` | `10px` |
| `line-height` | `1.4` | `1.25` |
| `background` / `max-width` / `font-weight` / 省略号 | 0.035 浅底 / 120px / 600 / ellipsis | **不变** |

**竖向 padding 不动 + `line-height 1.25`**：让 chip 总高与今天基本一致（≈16.5px vs 16.6px），
避免看板卡高度漂移、220px 窄列换行（与 `11-09-overview-card-metrics` 的 R5 同一原则）。

## 没动

- `is-tag`（#tag）与 `is-tag-more`（+n）的底色 / 透明度 / 字重；
- 状态 chip（`AgentStatusChip`）的语义与几何；
- DOM 结构、文案、`overview-board.tsx` / `session-overview.tsx`。

## 自检

- `npx vitest run frontend/app/session-overview --reporter=dot` → 现有用例全绿（CSS 改动不涉及逻辑）。
- 页面顶部测量条：BEFORE / AFTER 的 chip 宽高差应只在水平方向（实测 +8.5px），高度差 ≤ 1px
  （本机 Edge headless 实测：`54.1×16.6` → `62.6×16.5` px）。
- 真机观感由 nita 自行确认（本包不启动 Electron/CDP）。
