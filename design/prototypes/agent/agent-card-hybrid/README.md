# Agent Card 合体版 — C 的行 + D 的头像 + 右上三件套

> 同步状态：◐ 部分落地（2026-11-03：C 行骨架 + 头像/引用块 + 右上三件套已写入真实组件；折叠与 usage 指标仍是备选）
> 镜像源：frontend/app/view/term/agent-hover-card.tsx, frontend/app/element/info-card/info-card.scss, frontend/app/element/info-card/session-note-section.tsx, frontend/app/view/aisessions/property/property-list.tsx, frontend/app/view/aisessions/property/property-list.scss, frontend/app/store/session-note-hook.ts
> 最后同步：2026-11-03

把 `agent-card-beautify/` 8 套对照里**能共存的三个胜出点**合成一张卡：

1. **C（Raycast）** 的行骨架 —— `icon + label 左 / value 右`，一行一条信息；顺带做**文本简化**。
2. **D（GitHub）** 的身份表达 —— 30px 头像块（Logo / emoji / 文字徽标共用容器）+ 标题引用块。
3. **右上三件套** —— 状态 chip、收藏、放大按钮同一基线右对齐，不再各占一行。

## 实现落地后的偏差（以真实组件为准）

| 原型 | 真实实现 | 原因 |
| --- | --- | --- |
| 头像块紫色渐变 + 白字 | 中性底 + `inset` 描边，**保留 logo 自带厂牌色** | 真实卡片要展示 Claude / Codex / Pi 等不同品牌 logo，统一重涂会串味；emoji / 文字徽标人格共用同一容器 |
| 标题右上 hover 出 AI 标题 / metadata 两个按钮 | **移除**；AI 标题/metadata 生成只在详情卡与弹窗 | 写操作不适合 hover 预览；且 340px 卡里会压到标题字；hover 卡的 AI 入口只留 footer 的 `✨` 属性填充 |
| 折叠属性开关（140px 极简态） | 未实现；固定 4 行 | 折叠需要额外入口，用户没要求；先保持信息可发现 |
| `Duration / Cost / Context` 指标（E） | 未实现 | 需要把底栏 usage 数据接进卡片，单独任务 |
| `?collapsed` / `?hover` 深链 | 仅原型控制台使用 | — |

## 实现结果（实测）

| 场景 | 高度 |
| --- | --- |
| 旧卡片 @340（`agent-card-beautify` 方案 0） | 296px |
| 新卡片 @340（1 行标题、空 tags/note） | **251px** |
| 新卡片 @340（2 行标题 + tags + 2 行 note） | 259px |

落地细节见 [`docs/project/agent-card-layout.md`](../../../docs/project/agent-card-layout.md)；
任务记录 `.trellis/tasks/11-03-agent-card-hybrid/`。

## 打开方式

```bash
start design/prototypes/agent-card-hybrid/index.html
```

页面分三段：**主卡（可交互）+ 改动说明**、**五种状态**、**宽度与内容形态**（300 / 380 / 填充态 / 折叠 / emoji 人格 / 超长标题）。

深链（评审用）：

```
index.html?state=working&width=380
index.html?theme=light
index.html?collapsed=1        # 折叠属性区
index.html?hover=1            # 常显工具（截图评审用，不靠鼠标悬停）
```

## 结构与规格

```
┌───────────────────────────────────────────────┐
│ [30px 头像]  Pi                    ● Working ★ ⤢ │  ← 头部
│              未指定 · First message              │
│ ┃ 功能问题：列表编辑时文本位置抖动、样式变化…        │  ← 2px 状态色引用块，2 行
│ ◷ Updated                                     2 分钟前 │
│ ▤ Created                                     3 天前  │
│ ◇ Tags                                          —     │
│ ≡ Note                                          —     │
│ + Add property              ✨  3ce67d75…7ca2  ⧉ │  ← 单行 footer
└───────────────────────────────────────────────┘
```

| 部位 | 规格 | 说明 |
| --- | --- | --- |
| 头像块 | 30×30 / 圆角 9 / 品牌渐变 + 白字 | emoji、文字徽标人格时退成中性底（`.is-emoji`），字形自带颜色 |
| 名称 | 13px / 650 | 单行省略 |
| 副标题 | 10.5px mono / `text-3` | `model · title source`，把低价值元信息压成一行 |
| 状态 chip | 10.5px / 高 20 / 11% 底 + 26% 描边 | 颜色只染 chip 与引用线，不染整卡 |
| 星标 / 放大 | 20×20 / opacity 0.8 | 常驻（不是 hover 才出现），hover 提亮；收藏选中为 `--blocked` 琥珀色 |
| 标题 | 12.5px / 1.5 / 2 行 clamp | 左 2px 状态色竖线；`title` 挂全文 |
| 属性行 | 26px / icon 12 + label 68 + value 右对齐 | 无逐行分割线，行 hover 才出铅笔 |
| tags / note | 行高自动 / 右对齐 | tags 用 pill；note 两行截断 + tooltip |
| footer | 单行 + 顶部 hairline | 左 `+ Add property`；右 `✨` / session id（8+4 截断）/ 复制 |
| 折叠态 | 隐藏属性区 | 卡高约 140px，只剩身份 + 标题 + footer |

## 文本简化对照

| 现状 | 合体版 | 机制 |
| --- | --- | --- |
| `Title Source` 独占一行、值 `first_user_message` | 副标题里 `First message`，`title` 保留原值 | 复用 `humanizeKey`；source 归位到身份行 |
| `Tags: Empty` / `Note: Empty`（斜体英文） | `—` | 空值符号，不再读英文单词 |
| `Created Nov 3, 2026 11:21` | `3 天前` + `title="Nov 3, 2026 11:21"` | 相对时间 |
| `+ Add a property` 独立一行 | footer 内联 `+ Add property` | 收行 |
| `✨ AI auto-fill` 独立一行（虚线框） | footer 内联 `✨` 图标 + tooltip | 收行 |
| 完整 session uuid | `3ce67d75…7ca2` + tooltip 全量 | 截断 |
| 空 tags 一整行 | 保留一行 `—` | 保持可发现性（能看出这卡有 tags 字段） |

## 尺寸实测（340 宽 / 标题 2 行）

| | 高度 | 组成 |
| --- | --- | --- |
| 现状（`agent-card-beautify` 方案 0） | **296px** | 6 属性行 + 2 按钮行 + id 行 |
| 合体版 | **251px** | 4 属性行 + 单行 footer |
| 合体版 · 折叠 | 约 140px（实测） | 头部 + 标题 + footer |

页面右下角的高度是**实时测量**（`offsetHeight` 写回 DOM），换宽度 / 状态会自动更新，不是写死的数字。

## 与其它原型的关系

| 原型 | 关系 |
| --- | --- |
| `agent-card-beautify/` | 8 套方案的对照集；本目录是其中 **C 的行骨架 + D 的头像/引用块** 的合成落地版 |
| `agent-card-accent/` | 已落地的「左侧 3px 通长圆头色条」在本版被**移除**：状态改由右上 chip + 标题引用线表达 |
| `notion-property-agent-card/` | 属性编辑器（类型、AI 填充）仍复用那套；本版只做窄卡形态 |
| `agent-emoji-persona/`、`agent-avatar-text-badge/` | 头像块的三个分支（logo / emoji / 文字徽标），本版已用 `.is-emoji` 演示其中一态 |

## 实现落点

| 改动 | 文件 |
| --- | --- |
| 头像块 + 右上三件套 + 标题引用块 | `frontend/app/view/term/agent-hover-card.tsx` + `info-card/info-card.scss` |
| 属性行 icon / 右对齐 / 相对时间 / 空值 `—` | `frontend/app/view/aisessions/property/property-list.tsx`、`property-list.scss` |
| 星标从属性区移到头部（`PropertyList` 不再渲染 `starred` 行） | `property-list.tsx` + `agent-hover-card.tsx` |
| `Title Source` 归位到副标题 | `agent-hover-card.tsx` 复用 `TitleSourceBadge` 数据 |
| footer 收行（Add property / AI / id / copy） | `session-note-section.tsx`、`info-card.tsx` |

## 已知未做

- 未纳入 E 的 usage 指标（Duration / Cost / Context）；加进来会多一行 ~44px，需要重新算高度预算。
- 星标只是本地 state，未接 `SetProps`；复制只调 `navigator.clipboard`。
- 未做 detail 弹窗形态：520–640 宽时应把属性区展开成 `notion-property-agent-card` 的属性面板。
- 未测更极端的情况：超长英文 tag、三行 note、emoji 头像 + 22px 文字徽标三者同时出现。
