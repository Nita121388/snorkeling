# Tab 悬浮卡 · 8 套样式变体（原型）

> 同步状态：◐ 部分落地（2026-11-02 起，变体 #4 v-notion 已进 `tab-info-card.tsx` 与 `info-card.scss`；其余 7 个变体仅作参考）
> 镜像源：frontend/app/tab/tab-info-card.tsx, frontend/app/element/info-card/info-card.scss, frontend/app/tab/tab.tsx
> 最后同步：2026-11-02

> 关联方案笔记（Obsidian）：`My Projects/Snorkling/方案/AISessions/`（Tab 悬浮卡重设计，待补 wikilink）

---

## 背景

截图反馈两件事：Tab 悬浮卡的样式不满意，卡片里的图标也不喜欢。

现有卡片（`tab-info-card.tsx`）的问题：

| 问题 | 证据 |
|---|---|
| 同一事实说三遍 | 计数 `4 agents` + 分区标题 `Agents` + 4 行 Agent 清单 |
| 层级扁平 | 标题 / 计数 / provider / 状态全是 11px |
| 图标三套语言 | FA 单色 12px + persona emoji 13px + 7px 状态圆点 |
| 语义错配 | `fa-microchip` 表示 agent，`fa-bolt` 表示分组 |
| 状态重复 | Tab 上 badge 点 + 卡内圆点 + 卡内文字 |
| 宽度会跳 | 卡片 200–400px 自适应，`Tool: bash` 撑宽；状态列右贴边 |

## 原型做什么

同一份数据（workspace `PPT`、4 agents、2 chat、12 files、1 note、4 个 pi 会话分别为 working / thinking / idle / done），用 8 套成熟 UI 体系的表达方式各画一遍。切换时布局与图标体系一起变，方便对比「哪种图标方案配哪种排版」。

| # | 变体 | 参考体系 | 值得抄的点 |
|---|---|---|---|
| 1 | GitHub Hovercard | GitHub PR/Issue 悬停卡 | 1px 分隔线 + 键值元数据行；计数变 header 右侧等宽数字 |
| 2 | Linear Issue List | Linear 列表 / Command Menu | 22px 行高、全大写小标题，同高度塞两倍条目 |
| 3 | Raycast 命令面板 | Raycast 玻璃面板 | 20px tinted 图标容器，把任意 emoji 框成统一方块 |
| 4 | Notion / Things 3 | Notion 属性面板 | 状态改浅底 pill，不再右贴边，长状态不撑宽 |
| 5 | Vercel Geist / shadcn | Geist Popover / shadcn HoverCard | 全 1px hairline + 等宽数字，最贴近现有 InfoCard 中性基调 |
| 6 | Discord 成员列表 | Discord 成员侧栏 | 状态环挂头像右下角，身份与状态合成一个单元 |
| 7 | Warp 终端 | Warp Block 列表 | 2px 状态竖条替代 7px 圆点，与 Tab 上 agent 竖条呼应 |
| 8 | Windows Fluent 2 | Fluent 2 Card / 亚克力 | 亚克力模糊 + 描边胶囊状态（内含小圆点） |

## 共同的结构主张（8 套都遵守）

1. 计数并入 header 右侧，删掉独立计数行与 `Agents` 分区标题。
2. provider 相同时提到分组标题 `Agents · pi ×4`，行内不再重复 `pi`。
3. 行内主信息 = 动作 / 状态短语（`Tool · bash`、`Idle`），provider 降级。
4. 卡片定宽 268px，状态列定宽 + `tabular-nums`，行不跳动。
5. 无状态不再显示 `—`，统一显示 `Idle`。

## 落地记录

- 2026-11-02：选定变体 **#4 Notion / Things 3**，实现于 `.trellis/tasks/11-02-tab-card-notion-style`。
  - 结构：identity（图标 + 名称 + flag + agent 计数）/ hairline / `Agents · pi ×4` 分组标题 / 26px 行 + 状态 pill / 非 agent 属性 chips。
  - 图标：emoji 原样放行、统一 13px，不套容器（对应的 18px chip 方向留给 `10-29-agent-avatar-*`）。
  - 与原型的一处差异：属性 chips 改为**始终展示非 agent 计数**（原型在 agent 清单之外也显示），header 计数只显示 agent 数量 —— 避免有 agent 的 Tab 丢失 chat / note 计数。

## 推荐

- 布局取 **#2 Linear**（密度）或 **#5 Geist**（克制，改造成本最低）。
- 图标取 **#3 Raycast 的 tinted 容器**（保留 persona emoji，只换容器，不动 `getAgentIcon` 解析链）。
- 状态取 **#6 Discord 的状态环** 或 **#4 Notion 的 pill**，二选一，不要两套并存。

落地顺序建议：先布局（只改 `tab-info-card.tsx` + `info-card.scss:444-548`），再图标（新建 `<AgentIcon size="sm" variant="chip">`，与 `10-29-agent-avatar-*` 任务合并，避免两套实现）。

## 文件

- `index.html` — 原型主页面（左侧 8 变体导航 + 右侧模拟窗口与 Tab 栏）
- `style.css` — 全部变体样式（CSS 变量驱动明暗主题）
- `script.js` — 变体数据与渲染函数、`↑↓` / `←→` 切换、主题切换、Tab hover 联动

## 已知差异（原型 vs 真实组件）

- 原型状态色用独立变量；真实实现应走 `--agent-working-color` / `--agent-done-color` 等既有 token。
- 原型 emoji 使用系统彩色 emoji；真实环境可能出现文字呈现（单色）字形，chip 容器需按此兜底设计。
- 原型的 hover 触发简化成 `mouseenter`；真实实现走 `InfoCardPortal` + `hover.targetProps` 的延迟逻辑。
