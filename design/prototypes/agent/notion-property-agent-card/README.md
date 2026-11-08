# Session / Agent Card · Notion 式属性系统 — 像素级原型

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/element/info-card/session-note-section.tsx, frontend/app/view/aisessions/session-row.tsx, frontend/app/view/term/agent-hover-card.tsx, frontend/app/block/session-detail-info-card.tsx, frontend/app/view/preview/plugins/md-properties/frontmatter-block.ts, frontend/app/view/term/agent-logo.tsx
> 最后同步：2026-10-29

## 目的

把 Summery 上硬编码的 **Note + Tags** 升级为 **Notion 式「属性 schema + 属性值 + 类型化渲染」**，
并回答一个具体的视觉问题：**Agent 的 icon 到底是品牌 Logo 还是 emoji？**

本原型是「学习用」的像素级参照：把 Notion 页面属性区（page icon → title → property rows →
type picker → value editors → add property）按真实规格重建，再套到 Snorkeling 的 Agent Card 上。

配套设计文档：[`design/plans/aisession-notion-properties.md`](../../plans/aisession-notion-properties.md)

## 打开方式

```bash
open design/prototypes/notion-property-agent-card/index.html
```

纯静态，无依赖、无构建。

## 这个原型要回答的 3 个问题

| # | 问题 | 原型里的答案 |
|---|---|---|
| 1 | Note/Tags 不够用，属性系统长什么样？ | 页面属性区：任意类型 key→value 行 + `+ Add a property` + 完整类型选择器 |
| 2 | 用户和后台 AI 怎么共同写属性？ | 顶部 `✨ AI auto-fill`：AI 填已有属性 + 提议新属性（`Tech Stack`），值带 `✨` 来源标，可 Undo |
| 3 | icon 显示 Logo 还是 emoji？ | 分层覆盖：品牌 Logo（默认）/ provider persona emoji / block override emoji，点击 page icon 循环切换 |

## 可交互清单

**页面区**

- page icon：点击在 `🦊 emoji → 🐙 block override → 品牌 Logo` 之间循环
- title：可编辑（contenteditable）
- 属性行：hover 左侧出现 `⋮⋮` 手柄；点值进入对应编辑器；双击属性名重命名

**值编辑器**

- Select / Status：搜索浮层 + 彩色选项 + `Create "xxx"`
- Multi-select：chips 行内输入 + 选项 toggle + 新建
- Date：月历（‹ › 翻月）+ Today / Tomorrow / Next week / Clear
- Checkbox：点击切换
- Text / Number / URL：原地 inline 编辑（Enter 提交 / Esc 取消）
- Person / Relation：成员 / 会话选择
- Formula / Created / Last edited：只读

**类型与属性管理**

- `+ Add a property` → 完整类型选择器（Search + Basic / Advanced / System 分组 + 类型图标）
- `⋮⋮` 手柄 → Rename / Change type / Delete property
- Change type 会做 best-effort 值转换（select ↔ multi-select、text ↔ number 等）

**形态切换**

- `Wide`：完整页面属性（Detail 信息卡）
- `Narrow (Agent Card)`：窄卡形态，隐藏空值，前 5 条 + `+N more propert​ies`，可展开

## 深链（评审用）

```
index.html?demo=type                     # 打开类型选择器
index.html?demo=select                   # 打开 Select 编辑器
index.html?demo=multi                    # 打开 Multi-select 编辑器
index.html?demo=date                     # 打开日期选择器
index.html?demo=menu                     # 打开属性 ⋮⋮ 菜单
index.html?demo=ai                       # 触发 AI 自动填充（含 Undo）
index.html?card=narrow                   # 窄卡形态
index.html?icon=logo                     # 品牌 Logo（默认 emoji）
```

## 与真实 Notion 的差异（有意为之）

| 项 | Notion | 本原型 | 原因 |
|---|---|---|---|
| hover 类型图标 | 属性行不显示类型图标 | 本原型也不默认显示（只在类型选择器 / 属性菜单里） | 保持像素一致 |
| 属性名点击 | 选中/编辑 | 双击才重命名 | 避免与中国区用户单击预期冲突 |
| AI 来源标 | 无 | 值右侧 `✨` + tooltip | 双写者模型需要可辨识来源 |
| AI 新属性 | 无 | 「Suggested」概念在文档里，原型直接演示落位 | 演示最小闭环 |
| 窄卡 | — | 前 5 条 + `+N more` | Agent Card 的实际空间约束 |

## 视觉规格（照抄 Notion light）

- 字体：`ui-sans-serif, -apple-system, "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif`
- 正文 `#37352f` / 次要 `#787774` / 占位 `#9b9b9b`
- 页面 `#ffffff` / hover `rgba(55,53,47,.06)` / 分隔线 `rgba(55,53,47,.09)`
- 标题 `40px / 700 / 1.2`；属性行高 `32px`；chip 高 `20px` / 圆角 `3px` / 字号 `12px`
- 浮层宽 `320px` / 圆角 `8px` / Notion 三段阴影

## 已知未做

- Formula 表达式编辑（只做只读派生值）
- Rollup / Files / Email / Phone
- 真正的拖拽排序（`⋮⋮` 只打开菜单，未接 dnd）
- 多选 chip 的键盘导航（↑↓ / Backspace 删除）
- 深色主题（本版只复刻 Notion light）

## 与任务的关系

设计阶段产物，**不进入开发**。落地分期见设计文档 §7（P0 只读 → P1 内置属性编辑 → P2 AI 属性 → P3 自定义 schema）。
