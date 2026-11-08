# Files Block Header — 锁存式分区（进入即锁，离开恢复）

> 同步状态：● 已落地（2026-11-07，task 11-07-files-header-hover-latch）
> 镜像源：frontend/app/block/blockframe-header.tsx, frontend/app/block/block.scss, frontend/app/view/preview/preview-model.tsx, frontend/layout/lib/layoutModel.ts
> 最后同步：2026-11-07

```bash
start design/prototypes/files-header-split-reveal/index.html
```

## 需求（最终版）

1. 悬浮 header **左半** → 只出**左侧那组 icon**
2. 悬浮 header **右半** → 只出**右侧那组 icon**，且左侧（chevron + 路径）**收起让位**，腾出的宽度**全部转给右组**
3. **鼠标能真正点到右侧 icon** —— 不能因为 icon 越过中线就翻区、导致点不到（**核心陷阱**）
4. **一旦展开，整个 hover 会话内锁死** —— 鼠标在 header 里怎么移动都不换区
5. **块非常窄**（最窄 40px，`MinNodeSizePx = 40`）时功能一个都不丢

## 方案：锁存（latching），不是实时分区

**进入 header 那一刻**按进入点决定方向（`x < 中线 → LEFT`，否则 `RIGHT`），**之后整个 hover 会话内方向不可变**。
`pointermove` **完全不参与分区判定** —— 这是"右组向左伸过中线也完全无害"的结构性来源。

```
pointerenter ──► 按进入点判定方向 ──► LATCHED_LEFT / LATCHED_RIGHT
                                        │
                              pointermove 全部忽略
                                        │
pointerleave ──► 启动 resetTimer(graceMs) ──► GRACE（方向仍保持）
                                        │
        宽限内 pointerenter ──► 取消定时器，沿用原方向
        定时器到期 ──► NEUTRAL ──► 下次 pointerenter 才重新判定
```

| 状态 | 含义 | 转移 |
|---|---|---|
| `NEUTRAL` | 两侧都不展开，路径完整 | `pointerenter` → 按进入点判定 → 锁存 |
| `LATCHED_LEFT` | 左组展开，右侧不动 | `pointermove` **不改变**；`pointerleave` → 启动宽限 |
| `LATCHED_RIGHT` | 右组展开 + 左侧让位 | `pointermove` **不改变**；`pointerleave` → 启动宽限 |
| `GRACE` | 已离开，方向仍保持 | 宽限内 `pointerenter` → 取消定时器 + 沿用原方向；到期 → `NEUTRAL` |
| `FROZEN` | 溢出菜单 / 浮层打开 | `pointerleave` **不启动**定时器；关闭 → `NEUTRAL` |

**唯一代价**：想从左侧换到右侧，必须"离开 header → 等过宽限 → 从另一侧进入"。宽限可配（默认 400ms，拖到 0 = 离开立刻恢复）。这与菜单/工具条"离开即关"的直觉一致，且比"晃过去就换"更可预测。

## 为什么不用另外两种算法

| 算法 | header 内翻区 | 风险 |
|---|---|---|
| **中线实时切分** | 每次 `pointermove` 重算 | **必然自激**：右组越中线 → 翻 left → 右组消失 → 点不到 → 退回又翻回 → 无限闪烁 |
| **保持区 + 触发带** | 不翻（落在 icon 上命中保持区） | **逻辑复杂**：4 个矩形 + 优先级 + 空档宽限，边界多；鼠标停在 icon 间隙仍可能抖 |
| **锁存（本方案）** | **永不**，`pointermove` 不参与 | **最简**：3 状态 + 1 定时器，零几何判定，可纯函数单测 |

### 实测复现（中线实时切分为什么必然失败）

240px 块宽，Playwright 合成 pointermove 走真实代码路径，中线 = 119：

| 位置 | 中线实时切分 | 锁存 |
|---|---|---|
| `pointerenter` @80% | `right` | `right` |
| `move` → `goto` @x=35 | **`left` ← 翻区！** | `right` |
| `move` → `html` @x=61 | — | `right` |
| `move` → `target` @x=87 | — | `right` |
| `move` → `vcs` @x=119 | — | `right` |
| `move` → `dots` @x=145 | — | `right` |
| `move` → `refresh` @x=169 | — | `right` |
| `move` → `pen` @x=195 | — | `right` |
| `move` → `x` @x=221 | — | `right` |
| `move` @50% / 25% / 5% | — | `right` |
| 结论 | **FAIL**（右组第 0 个 icon 就翻区） | **PASS**（全程 `right`） |

## 三项自动断言（原型内可点）

| 断言 | 内容 | 结果 |
|---|---|---|
| ① 进入后横穿全宽 | `pointerenter` @80% → 沿全部可见 icon 逐个 `pointermove`（含 `goto` @x=35 < mid=119）→ zone 必须恒为 `right` | **PASS** |
| ② 离开 → 宽限内回来 | `pointerleave` → `graceMs-150ms` 内从**左侧** @15% 重新进入 → 方向必须**仍是 `right`** | **PASS** |
| ③ 离开 → 超宽限 → 另一侧进入 | 等过 `graceMs+200ms` → 状态回 `NEUTRAL` → 从左侧进入 → 必须切成 `left` | **PASS** |

## 窄块降级阶梯

`MinNodeSizePx = 40`。Markdown 场景共 12 icon，**192px 以下连一半（6 个）都放不下**。

| tier | 宽度 | 右锁态行为 |
|---|---|---|
| 0 | ≥360px | 完整态，12 个全在 header，路径完整 |
| 1 | 240–360px | 右组按优先级收进 `…` |
| 2 | **192–240px** | 不到一半。**`…` 从"备用"升为主入口**，永不参与削尾 |
| 3 | **88–192px** | header 只留 **类型图标 + `…`**，pinned 全进溢出 |
| 4 | **<88px** | header 只剩 **类型图标**；点击它 → **浮层工具条**铺开全部 icon |

左锁态同样走阶梯（`…` 恒在），不会因为"左组只有 3 个"就无限塞。

### 可达性硬判据（机器可判定，左右两方向都测）

> **任何宽度、任一锁存方向下：header 可见 + 溢出菜单 + 浮层 = 12**

实测 10 个宽度 × 左右两方向，**全部 PASS**：

| 块宽 | tier | 左锁可见 | 右锁可见 | 溢出 L/R | 浮层 L/R | 合计 L·R | 判定 |
|---|---|---|---|---|---|---|---|
| 40px | 4 | 0 | 0 | — | 12 / 12 | **12·12/12** | PASS |
| 62px | 4 | 0 | 0 | — | 12 / 12 | **12·12/12** | PASS |
| 88px | 3 | 1 | 1 | 11 / 11 | — | **12·12/12** | PASS |
| 120px | 3 | 1 | 1 | 11 / 11 | — | **12·12/12** | PASS |
| 160px | 3 | 1 | 1 | 11 / 11 | — | **12·12/12** | PASS |
| 192px | 2 | 3 | 6 | 9 / 6 | — | **12·12/12** | PASS |
| 240px | 1 | 3 | 8 | 9 / 4 | — | **12·12/12** | PASS |
| 300px | 1 | 3 | 10 | 9 / 2 | — | **12·12/12** | PASS |
| 360px | 0 | 3 | 12 | 9 / 0 | — | **12·12/12** | PASS |
| 520px | 0 | 3 | 12 | 9 / 0 | — | **12·12/12** | PASS |

**对照组（现状）**：`overflow: hidden` 硬切 —— 140px 下 3 个可见、**4 个被裁**；240px 下 **6 个全被裁**。被裁的 icon **既不在菜单也不在浮层**，功能真的丢了。这是当前窄块下 vcs / More 点不到的根因。

## 削尾优先级

从低到高被收进 `…`：`box`(6) → `magnify`(5) → `book-open`(4) → `book`(4) → `eye`(3) → `html`(3) → `target`(2) → `goto`(2) → `tree`(2)

**永不进溢出**：`code-branch`（vcs 主入口）、`ellipsis`（溢出容器本身）、`close`

## 原型内容

| 控件 | 作用 |
|---|---|
| 主题 Dark / Light | 真实 `theme.scss` 变量 |
| 内容 Markdown 12 / 目录 11 / 文件 10 | 三套 icon 组合 |
| 宽度滑杆 | **40~900px**，可拖到 40px 看 tier 4 浮层态 |
| **恢复宽限滑杆** | **0~1200ms**，默认 400；拖到 0 = 离开立刻恢复 |
| 显示锁存态 | header 描边 + `LATCHED` 标记 + 组描边 |
| **三项自动断言按钮** | 合成 pointer 事件走真实状态机，输出事件序列 + PASS/FAIL |

两个面板并排：**锁存式（推荐）** vs **实时中线（有缺陷，可亲眼看到翻区）**。点 `…` 展开溢出菜单；tier 4 点类型图标展开浮层。

## 落地要点

1. **状态机纯函数**：`reduce(state, event)`，事件仅 `ENTER(x)` / `LEAVE()` / `RESET()` / `FREEZE()` / `UNFREEZE()`。零 DOM 依赖，**可直接单测全部转移**。
2. **单一定时器**：`resetTimer`；`FREEZE` 时取消并不再启动。用 `pointerenter` / `pointerleave` 而非 `mouseenter` / `mouseleave`（兼容触控笔）。
3. **进入点中线**取 `pointerenter` 时刻的 header `getBoundingClientRect()`（此时未让位，中线稳定）。
4. **不动 `isHovered`**：它与 `claimInfoCard` / Agent·Note 悬浮卡共用。锁存状态独立成 `hoverLatch`。
5. **分配不变量**：`plan(w, zone)` → `{shown, hidden}`，**`shown.length + hidden.length === total`** 写单测；`w ∈ [40..900] step 2` 全跑，`zone ∈ {left, right}` 都跑。
6. **`IconButtonDecl` 加字段**：`priority?: number`（越大越先收进溢出）、`neverOverflow?: boolean`。默认 `priority: 0` 不参与削尾。
7. **左侧让位**：把 `preIconButton + iconview + HeaderTextElems` 包进 `.left-zone`；让位时只隐藏 chevron 与路径（保留类型图标）。用 `max-width` 过渡而非 `display:none`。
8. **`preview-model.tsx`**：Go to Path / 列表树切换 从 `viewText` children 移到新 `startIconButtons` atom（对称 `endIconButtons`）。
9. **设置项**：`block:header-split-reveal` / `block:header-yield-left` / `block:header-narrow-tier` / `block:header-hover-latch`（bool）+ `block:header-hover-grace`（数值，默认 400），默认 on。
10. **像素验证**：`scripts/verify/` 新增 area，断言 ①header 内每个可见 `.ibtn` 的 rect 完全落在 header 矩形内（禁止硬切）②`pointerenter` 后沿组内 icon 逐点 hover，`data-latched` 恒定。
11. **影响面**：`blockframe-header.tsx` 是全 block 共用 header。term 走 `useTermHeader` 分支需确认不受影响；`aisessions` 自定义 `endIconButtons` 需检查 `priority` 默认值。

## 验证证据

`verify-runs/2026-11-06-files-header-split-reveal/`（Playwright + Edge `channel: msedge`）：

| 文件 | 内容 |
|---|---|
| `50-latch-assertions.png` | 三项断言全 PASS + 事件序列 |
| `53-realpointer.png` | 真机 `page.mouse` 轨迹：`goto @x=35`（mid=119）仍 `right` |
| `51-w{900,520,360,300,240,192,160,88,40}.png` | 九档宽度态 |
| `52-light-300.png` | Light 主题 |
| `30/31/32-*.png`, `40/41/42/43-*.png` | 上一版（触发带方案）留档，已被锁存方案取代 |

控制台：无 `pageerror` / 无 `console.error`。
