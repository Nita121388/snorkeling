# PRD · Files Block Header 锁存式分区

> 任务：`.trellis/tasks/11-07-files-header-hover-latch`
> 原型：`design/prototypes/files-header-split-reveal/index.html`（已评审通过，三项断言 + 可达性表全绿）

## 1. 问题

Files Block header 在窄块下 icon **显示不全**：`.block-frame-end-icons` 的 reveal 区默认 `display:none`，悬浮时全部 `display:flex` 涌出，header 是 `display:flex` 且父链上没有任何收缩预算 → 放不下的部分被 `overflow:hidden` **硬切**。

实测（现状，Playwright 真机）：

| 块宽 | 可见 icon | 被硬切 |
|---|---|---|
| 240px | 0 | **6 个全被切**（`vcs` / `More` 点不到） |
| 180px | 3 | 3 |
| 140px | 4 | 4 |

被切的 icon **既不在溢出菜单也不在浮层** —— 功能真的丢了，不是"藏起来"。

同时，块越窄路径被挤得越短（`…del.tsx`），而右侧 icon 一个都不让。

## 2. 目标

1. 悬浮 header **左半** → 只揭示**左侧**那组 icon（`Go to Path` / 列表树切换 / 打开方向 / HTML 打开方式 等）。
2. 悬浮 **右半** → 只揭示**右侧**那组（vcs / TOC / Obsidian / More / magnify / inline-minimize / Refresh / Edit / Close），并且**左侧 chevron + 路径收起让位**，腾出的宽度**全部转给右组**。
3. **鼠标必须能真正点到展开的 icon** —— 不允许出现"因为 icon 越过 header 中线导致分区翻面、icon 消失、点不到、来回闪"。
4. **任何宽度下功能零丢失**：`header 可见 icon + 溢出菜单内 + 浮层内 = 该视图 icon 总数`，下探到 `MinNodeSizePx = 40`。
5. 不动 `isHovered` 语义（它与 `claimInfoCard` / Agent·Note 悬浮卡共用）。

## 3. 核心约束：锁存（latching）语义

**方向只在 `pointerenter` 判定一次，之后整个 hover 会话内不可变。`pointermove` 完全不参与分区判定。**

这是消除自激（右组向左伸过中线 → 重新判定为 left → 右组消失 → 点不到 → 退回又翻回 → 无限闪）的**结构性**手段，不依赖任何几何优先级/保持区/触发带。

| 状态 | 含义 | 转移 |
|---|---|---|
| `NEUTRAL` | 两侧都不展开，路径完整 | `pointerenter` → 按进入点 `x < 中线 ? left : right` → 锁存 |
| `LATCHED_LEFT` | 左组展开，右侧不动 | `pointermove` 不改变；`pointerleave` → 启动宽限定时器 |
| `LATCHED_RIGHT` | 右组展开 + 左侧让位 | `pointermove` 不改变；`pointerleave` → 启动宽限定时器 |
| `GRACE` | 已离开，方向仍保持 | 宽限内 `pointerenter` → 取消定时器 + **沿用原方向**；到期 → `NEUTRAL` |
| `FROZEN` | 溢出菜单 / 浮层打开 | `pointerleave` **不启动**定时器；关闭 → `NEUTRAL` |

- 默认宽限 **400ms**，可配 0–1200ms；`0` = 离开立刻恢复。
- 换方向必须"离开 header → 等过宽限 → 从另一侧进入"。这是**有意接受**的代价：与菜单/工具条"离开即关"的直觉一致，比"晃过去就换"可预测。
- 进入点中线取 `pointerenter` 时刻的 header `getBoundingClientRect()`（此时尚未让位，中线稳定）。

## 4. 窄块降级阶梯

`MinNodeSizePx = 40`。Markdown 场景 12 个 icon（左 3 + 右 6 + pinned 3），192px 以下连一半都放不下。

| tier | 宽度 | 右锁态行为 |
|---|---|---|
| 0 | ≥ `12*26 + 12 + 16 = 340` | 完整态，全部 icon 在 header，路径完整；右组本就放得下时**不让位** |
| 1 | 240–340px | 右组按优先级收进 `…` |
| 2 | 192–240px | 不到一半，`…` 升为主入口，永不参与削尾 |
| 3 | 88–192px | header 只留 **类型图标 + `…`**，pinned 全进溢出 |
| 4 | < 88px | header 只剩**类型图标**；点击它 → **浮层工具条**铺开全部 icon |

左锁态走同一阶梯（`…` 恒在），不会因为"左组只有 3 个"就无限塞。

**削尾优先级**（数字越大越先被收进 `…`）：`box`(6) → `magnify`(5) → `book-open`(4) → `book`(4) → `eye`(3) → `html`(3) → `target`(2) → `goto`(2) → `tree`(2)。
**永不进溢出**：`code-branch`(vcs)、`ellipsis`(溢出容器本身)、`close`。

## 5. 验收判据（机器可判定）

| # | 判据 | 命令 → 期望 |
|---|---|---|
| A1 | 分区纯函数不变量 | 单测：`plan(w, zone, scene)` 返回 `{shown, hidden, mode}`，`w ∈ [40..900] step 2` × `zone ∈ {left,right}` 全跑，断言 `shown.length + hidden.length === total`，且 `mode==="flyout"` 时 `hidden.length === total` |
| A2 | 状态机不变量 | 单测：`ENTER` 后连续 100 个任意 x 的 `MOVE` 事件 → state 的 `zone` 不变；`LEAVE` 后 `graceMs-1` 内 `ENTER` → 方向不变；`LEAVE` 后 `graceMs+1` → `NEUTRAL`，再 `ENTER` 另一侧 → 切换 |
| A3 | 无硬切 | 真机：任何宽度下 header 内每个可见 `.ibtn` 的 `getBoundingClientRect()` 完全落在 header rect 内（`right <= header.right - 1`），被切数恒为 0 |
| A4 | 可达性 | 真机：`header 可见 + 溢出菜单项数 + 浮层项数 === total`，在 40/62/88/120/160/192/240/300/360/520 × 左右两方向全 PASS |
| A5 | 锁存不翻区 | 真机：`pointerenter` @80% 后，沿 header 内全部可见 icon 逐个 `pointermove`（含 `x < 中线` 的 icon），`data-latched` 恒为 `right` |
| A6 | 宽限语义 | 真机：`pointerleave` → 宽限内从另一侧 `pointerenter` → 方向不变；超过宽限 → 回 `NEUTRAL` 后从另一侧进入 → 切换 |
| A7 | `isHovered` 不受污染 | 单测/真机：锁存状态变化不影响 `isHovered`；Agent·Note 悬浮卡仍按原逻辑 300ms 收起 |
| A8 | 存量面不回归 | 真机：`aisessions` 自定义 `endIconButtons`、`term` 的 `useTermHeader` 分支、`vcs` 面板 header 的 icon 数量与点击行为不变 |

## 6. 非目标

- 不改 `blockframe-header.tsx` 之外的其他 header（`term` 走 `useTermHeader` 分支保持原样；`aisessions` 只补 `priority` 默认值）。
- 不引入"header 内直接换边"的快捷方式。
- 不做 icon 排序/换位偏好设置。
- 不动 `overflow:hidden` 之外的其他裁剪路径（`iconview` 的跑马灯）。

## 7. 回退开关

| key | 类型 | 默认 | 作用 |
|---|---|---|---|
| `block:headersplitreveal` | bool | true | 关闭 → 退回"悬浮即全展开"的旧行为 |
| `block:headeryieldleft` | bool | true | 关闭 → 右锁时左侧不让位（只揭示右组，不腾宽度） |
| `block:headernarrowtier` | bool | true | 关闭 → 不做 tier 削尾，退回硬切（仅用于对照/排查） |
| `block:headerhoverlatch` | bool | true | 关闭 → 退回中线实时切分（可复现自激缺陷，仅用于对照） |
| `block:headerhovergrace` | number | 400 | 宽限毫秒数，钳制 0–1200 |

五个 key 都要进 `pkg/wconfig/settingsconfig.go` + `metaconsts.go` + `frontend/types/gotypes.d.ts` + `pkg/wconfig/defaultconfig/settings.json` + `schema/settings.json` + `frontend/app/block/blockenv.ts` 的 `getSettingsKeyAtom` 联合类型。
