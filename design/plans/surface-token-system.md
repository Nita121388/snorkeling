# 表面 / 文字 / 排版 体系统一方案

> 时间：2026-09-08
> 目标：**一套体系，各处取不同层**——统一的是"取哪一层、怎么表达"，不同的是"各处选哪一层、用哪种表达手段"。

---

## 1. 现状：三个真实的不一致（先摆证据）

| # | 问题 | 证据 |
|---|---|---|
| **U1** | **代码块高亮双轨**：md 预览用 `rehype-highlight` 固定暗色 `github-dark-dimmed`；AI 输出用 shiki **按主题切换**（`github-light` / `github-dark-high-contrast`） | `markdown.scss:4` vs `streamdown.tsx:16,247` |
| **U2** | **浅色主题缺"浮层"这一层**：`--overlay-bg-color` 只在 dark 块定义，浅色下 popover / 菜单 / 提示都退回 `--main-bg-color`（与页面同色，浮不起来） | `theme.scss` 仅 dark 有；`markdown.scss:720,1204,1262` 都在用 |
| **U3** | **表面变量三套并存**：`--panel-bg-color`（半透明卡片）、`--highlight-bg-color`（选中/行内）、`--overlay-bg-color`（浮层），属性卡片混用前两者，callout 直接硬编码 GitHub 色 `#388bfd 6%` | `markdown.scss:268/464/479/347-363`、`obsidian-properties-card.scss` |

另外：终端（xterm）自带配色，不走 CSS 变量——**这是对的，保持**。

---

## 2. 体系

### 2.1 表面四层（elevation）

| 层 | 语义 | 谁用 | 表达方式 |
|---|---|---|---|
| **L0 背景** | 页面底色 | 终端、md 正文、预览底 | 无表面，纯背景 |
| **L1 面板** | 比背景浅半档的"抬起表面" | 属性卡片、表格、Widgets、面板 | 面板色 + 1px 边框 |
| **L2 嵌入** | 比所在层**深一档**的"凹槽" | **代码块**、行内代码、输入框、chip 槽 | 比背景深 ~4%（Wolai/Notion/GitHub 同逻辑） |
| **L3 浮层** | 最高层，必须浮起来 | popover、菜单、tooltip、模态 | 不透明 + 双层阴影 + 6px 圆角 |

> 关键约定：**L1 抬起、L2 下沉、L3 悬空**。同一处不混用两种方向。

### 2.2 文字三层 + 代码专用

| 层 | 谁用 |
|---|---|
| `--text-primary` | 正文、值 |
| `--text-secondary` | 属性键名、行号、时间戳、占位提示 |
| `--text-muted` | 禁用、弱提示 |
| `--code-text` | **代码专用**：浅色主题主文字是棕色（`#4c3924`），代码需要更中性偏深才清晰 |

### 2.3 语义色（不占层级，靠色相区分）

- 代码 token：`--code-token-{comment,keyword,string,number,function,attr,type,meta}`
- 属性 chip：`--ptag-*`（hash 派生，**数据在色相上，不在层级上**）
- 状态提示（callout/success/warn/error）：应改为主题变量，**现状硬编码 `#388bfd 6%` 等要换掉**

### 2.4 排版层级

| 用途 | 字号 / 行高 |
|---|---|
| 正文 | 14 / 1.5 |
| 代码 | **13 / 1.6**（≈20.8px，贴近 Wolai 的 22px；比正文小一点，块边界更清楚） |
| 辅助（顶栏、语言 badge、"展开全部"） | 11–12 / 1.4 |

字体栈（**加前缀、不替换**，装了就用、没装回退）：
`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "JetBrains Mono", "Hack", "Microsoft YaHei", monospace`

---

## 3. 各处怎么取（统一里的不同）

| 场景 | 层 | 表达 | 本处特点（ why differ ） |
|---|---|---|---|
| **终端** | L0 | 无表面，xterm 自带主题 | 内容最密集，加边框只会吵；**不参与 CSS 表面体系** |
| **md 正文** | L0 | 无 | — |
| **代码块** | **L2** | 深一档 + 顶栏（语言常驻）+ 长块折叠 | 正文里的"嵌入物"，下沉才有块感；命令类执行按钮常驻（终端产品特色） |
| **行内代码** | L2（弱） | 幅度减半 + 4px 圆角 | 不能抢正文注意力，只做轻微暗示 |
| **引用块** | L1（弱） | **靠左侧竖线**，底色极浅 | 层次用"线"表达，不用色块 |
| **表格** | L1 | 面板底 + 边框 + 斑马纹 | 大面积，需要边框定界 |
| **属性卡片** | L1 | 面板底 + 边框；chip 用 20% 语义色 | 卡片是"抬起"的容器，chip 是"数据"（色相区分，不占层级） |
| **AI 输出** | L0 + 代码块走 L2 | 与预览代码块**同一套** | 现在两套引擎 → 必须统一（U1） |
| **popover / 菜单 / 模态** | **L3** | 不透明 + `0 0 0 1px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.2)` | 必须压住一切，浅色缺定义（U2） |

---

## 4. Token 与四主题取值矩阵

新增（集中在 `theme.scss`，四个主题各一套）：

| Token | dark | light | light2 | monochrome |
|---|---|---|---|---|
| `--surface-inset`（L2，代码块/行内代码） | `#1c1c1c` | `#e4ddca` | `#f2ede2` | `#f0f0f0` |
| `--surface-overlay`（L3，浮层） | `#212121`（现 overlay-bg） | `#fffdf7` | `#fffdf8` | `#ffffff` |
| `--code-text` | `#e6e6e6` | `#3a3226` | `#382603` | `#0a0a0a` |
| `--text-muted` | `#8e8e8e` | `#777167` | `#777167` | `#808080` |
| `--code-token-*`（8 个） | GitHub Dark Dimmed | GitHub Light | GitHub Light | 灰阶 |

复用现有：`--main-bg-color`(L0)、`--color-surface`/`--panel-bg-color`(L1)、`--main-text-color`/`--secondary-text-color`。

> 取值原则：**L2 比 L0 深约 4%**（暖色相保持），**L3 用不透明近白/近黑**（浮起）。

---

## 5. 三个必须修的不一致

1. **U1 高亮双轨** → 预览代码块继续用 `rehype-highlight` + 变量化 token（已落地半套），并把 AI 侧 shiki 主题对齐到同一色板；长期可考虑统一到一个引擎。
2. **U2 浅色缺 L3** → 给 light/light2/monochrome 补 `--surface-overlay`（popover、菜单、tooltip 才有浮起感）。
3. **U3 表面变量三套** → 新代码一律用 L0/L1/L2/L3；旧处按"表格→L1、引用→L1弱、callout→语义色变量"渐进替换，不一次性重写。

---

## 6. 迁移步骤（每步独立可验收）

1. **建 token**：`theme.scss` 四主题补齐 L2/L3/代码文字/muted/token 变量（含浅色 L3）
2. **代码块换到 L2**：`--codeblock-bg-color` → `--surface-inset`；文字 → `--code-text`
3. **属性浮层换到 L3**：`property-value-popover.scss` 用 `--surface-overlay`；chip 保持 20% 语义色（数据层，不占层级）
4. **行内代码 / 引用 / 表格 / callout** 逐个归位（每处一个 commit，可单独回滚）
5. **对齐 AI 与预览的代码配色**（U1）

---

## 7. 验收

- 四套主题下：**终端=背景、代码块=下沉、卡片=抬起、浮层=悬空**，层次方向一致
- 浅色主题：代码块暖色不显白、浮层能看出浮起、代码文字清晰
- 同一段代码在 md 预览与 AI 输出里配色一致
- callout 等语义色随主题变化，不再有硬编码 GitHub 蓝
- 启动耗时无变化（纯变量）
