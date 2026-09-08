# Markdown 各块样式优化方案（Wolai 实测对照）

> 时间：2026-09-08
> 采样方式：bb-browser **实例 B**（19826，独立 profile，不影响实例 A）
> 自动挑选路径：空间笔记（Vue-Vben-Admin / ES）→ 块类型偏少 → **模板中心**自动预览模板 → 命中
> `callout / quote / divider / todoList / subHeader / tinyHeader / blockEquation / page / database` 等样本
> 证据分级：**[实测]** = 量到的计算样式；**[推断]** = 由结构推导

---

## 1. Wolai 实测（亮色主题）

| 块 | 关键数值 |
|---|---|
| **正文 text** | 16px / **26px**（1.625），400，`rgba(0,0,0,.85)`，块 padding `3px 2px`，行高 29–32px |
| **H1 header** | **28px / 36px**，**600**，块高 42px |
| **H2 subHeader** | **19px / 26px**，600，高 32px |
| **H3 tinyHeader** | **16px / 24px**，600，高 30px |
| **引用 quote** | 14/21，**左 padding 20px**，**文字灰 `rgba(140,140,140,1)`**，**无边框、无底色** |
| **Callout** | 容器底 **`rgba(140,140,140,0.08)`** + **3px 圆角** + **16px 全内边距** + **20×20 emoji 与文字同行**，**无左边框** |
| **分割线 divider** | 线 **1px**，容器高 **13px**（上下各约 6px） |
| **待办 todoList** | 14/23，图标 svg **24×24**，行高 29px，padding `3px 2px` |
| **公式块** | 高 56px，padding 0 |
| **表格/数据库** | 单元格 `min-height 32px`、`line-height 22px`、`padding 5px 8px` |

> 模板预览里正文为 14/23（1.64），与笔记页 16/26 比例一致 → **行高统一 1.62~1.64 是 Wolai 的稳定值**。

---

## 2. 我们现状

| 块 | 现状 |
|---|---|
| 引用 | `border-left: 3px` + `border-radius: 0 4px 4px 0` + `--panel-bg-color` 底 + `padding: .714em 1em` |
| Callout | `padding: .714em 1em .714em 2.8em`（emoji **绝对定位** left .5em）+ 圆角 `4px 6px 6px 4px` + 3px 左边框 + `--panel-bg-color` 底 |
| 标题 | `.heading` 只管 margin/weight/padding，**字号靠浏览器默认 h1–h6** |
| 正文 | `line-height: 1.5` |
| 待办 | 原生 checkbox（`accent-color`），尺寸用浏览器默认（≈13px） |
| 分割线 | `border-top: 1px` + `margin: .714em 0`（总高约 21px） |
| 表格 | `th/td padding .5em .857em`，行高 1.45，`th` 用 `--panel-bg-color` |

---

## 3. 逐块建议

### ① 引用块 —— 采纳"弱化"，保留竖线

Wolai 是 **20px 缩进 + 灰字**，无边框无底。建议混合：

```scss
blockquote {
    margin: 0.5em 0.714em;
    padding: 0.4em 1em;                    // 收紧上下（Wolai 几乎无上下 padding）
    border-left: 3px solid var(--border-color);
    border-radius: 0 4px 4px 0;
    background-color: transparent;          // ← 去掉面板底（浅色主题下会发白/发脏）
    color: var(--secondary-text-color);     // ← 采纳 Wolai：引文用次要色弱化
    line-height: 1.6;
}
```
**保留竖线**的理由：md 预览里引用常是长段落，需要边界；Obsidian/GitHub 也都有。

### ② Callout —— 对齐 Wolai 的容器，保留我们的语义色

```scss
.markdown-alert {
    padding: 16px;                          // ← Wolai 的 16px（原 2.8em 左内边距太宽）
    border-radius: 4px;                     // ← 统一（原 4/6/6/4 不对称）
    background-color: color-mix(in srgb, var(--main-text-color, #888) 8%, transparent); // ← Wolai 的 8% 灰
    border-left: 3px solid var(--border-color);
}
```
- emoji 从"绝对定位"改为 **20px 与文字同行（flex）**（Wolai 做法，基线更整齐）
- **保留语义色左边框**：Wolai 的 callout 是统一灰色，我们的 GitHub Alert 分 note/tip/warning/caution，用色边框更有信息量——这是**我们强于 Wolai 的地方，不照搬**

### ③ 标题 —— 显式化，别再靠浏览器默认

Wolai 比例（以正文为 1）：H1 **1.75×**、H2 **1.19×**、H3 **1.0×（仅加粗）**，行高 1.25–1.3。
我们正文 14px → 建议：

| 级 | 字号 | 行高 | 字重 |
|---|---|---|---|
| H1 | 24px | 1.3 | 600 |
| H2 | 18px | 1.3 | 600 |
| H3 | 15px | 1.35 | 600 |
| H4–H6 | 14px | 1.4 | 600 |

margin 保持现状（`1.143em / .571em`，与 Wolai 的块间距接近）。

### ④ 正文行高 —— 1.5 → **1.6**

Wolai 稳定在 1.62–1.64；1.5 在长文里偏挤。这是**投入最小、收益最明显**的一条。

### ⑤ 待办 —— 勾选框放大 + 完成态弱化

- 勾选框 **16px**（Wolai 24px 对我们偏大，16 是舒适值），垂直居中
- 完成项：`text-decoration: line-through` + `color: var(--secondary-text-color)`

### ⑥ 分割线 —— 收紧

`margin: .714em 0` → **`.45em 0`**，总高约 13px（对齐 Wolai）。

### ⑦ 表格 —— 单元格对齐 Wolai 密度

`padding: .5em .857em` → **`6px 10px`**，行高 1.45 → **1.5**（Wolai 单元格 `5px 8px` / 行高 22px）。

---

## 4. 明确不照搬

| Wolai | 我们 | 原因 |
|---|---|---|
| 引用无竖线 | 保留 3px 竖线 | 长引用需要边界，且 Obsidian/GitHub 同 |
| Callout 统一灰色 | 保留语义色边框 | 分类型信息量更大 |
| 待办图标 24px | 16px | 我们预览密度更高，24 太抢 |
| 正文 16px | 保持 14px | 预览区空间有限，14 更紧凑 |

---

## 5. 落地清单

| 文件 | 改动 |
|---|---|
| `frontend/app/element/markdown.scss` | `blockquote` / `.markdown-alert` / `hr` / `th,td` / 正文 `line-height` / `.markdown-task-checkbox` / 新增 `.heading h1–h6` 字号 |
| `frontend/app/element/markdown.tsx` | Callout 结构微调（emoji 从 absolute 变同行）——**若结构改动大，可留在 P2，先做纯样式的部分** |

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 标题显式化改变既有观感 | 只调字号/行高，margin 不动；四主题各看一眼 |
| Callout 改 flex 影响 inline-edit 行坐标 | 不改 DOM 文本，只改布局；若担心 → emoji 布局放 P2 |
| 去掉引用底色后层次变弱 | 保留竖线 + 文字弱化；若觉得太素可加 4% 底色 |
| 行高 1.5→1.6 影响表格/卡片内文字 | 只改 md 正文容器，卡片/表格单独设行高 |

## 7. 验收

1. 明暗两套主题：引用（竖线+灰字）、Callout（8% 底+16px+同行 emoji）、标题三级、待办、分割线、表格各截一张
2. 长文可读性：正文行高 1.6 下段落不挤
3. inline-edit：改完样式后双击编辑行号仍对齐（尤其 Callout 与引用）
4. 启动耗时无变化（纯样式）
