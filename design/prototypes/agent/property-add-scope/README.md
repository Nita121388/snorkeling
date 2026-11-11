# Add property · 范围三选一 + 表单美化 — 像素级原型

> 同步状态：◐ 部分落地（2026-11-11：UI 浮层 + 范围三选一 + AgentPropertyDefType.Scope + 外部写入/读取已实现；真机 CDP 验证未跑——用户要求不跑真机）
> 镜像源：frontend/app/view/aisessions/property/property-list.tsx, frontend/app/view/aisessions/property/property-store.ts, frontend/app/view/aisessions/property/property-schema.ts, frontend/app/element/info-card/session-note-section.tsx, frontend/app/element/info-card/info-card.scss
> 最后同步：2026-11-11

## 目的

Agent 卡片「新增属性」的两个问题：

1. **范围不可选**：当前 `AddPropertyForm` 只有「本会话 + Save to template 复选框（**默认勾选** = 每次都在悄悄改全局模板 `agent:propertyschema`）」。没有「只给我的 pi 会话加」这一档。
2. **控件丑**：footer 一行挤 5 个控件（裸 input + native select + 10px 复选框 + Add + ✕），与卡片其余部分的 Notion 视觉语言脱节。

本原型回答新表单的视觉与交互：**浮层面板 + 类型选择器 + 范围三选一（仅此会话 / 仅此 Agent / 所有会话）**，并用一张交互矩阵演示三种范围各自影响哪些会话。

## 打开方式

```bash
open design/prototypes/agent/property-add-scope/index.html
```

纯静态，无依赖、无构建。

## 这个原型要回答的 3 个问题

| # | 问题 | 原型里的答案 |
|---|---|---|
| 1 | 范围怎么选？ | 三选一 radio 组：仅此会话（默认）/ 仅此 Agent（pi）/ 所有会话；`Save to template` 复选框删除 |
| 2 | 表单长什么样？ | portal 风格浮层：图标 input（名字）+ 自定义类型下拉（图标 + label + 勾选态）+ 范围组 + Cancel/Add，Enter 提交 / Esc 关闭 |
| 3 | 三种范围影响哪些会话？ | 下方矩阵实时演示：session → 只本会话；agent → 本会话 + 所有 pi 会话；all → 全部会话 |

## 方案要点（与代码事实对齐）

- **数据模型**：`AgentPropertyDefType`（`pkg/wconfig/settingsconfig.go:82`）增加 `Scope string`（`""`=全局 / `"agent:<origin>"`）；缺省空 = 全局，**旧数据零迁移**。模板仍是单一 config key `agent:propertyschema`，不做每 agent 一个 key。
- **合并逻辑**：`toPropertyDefs(summary, schema)` 只并入 scope 匹配的模板项（空 scope 或 `agent:${summary.origin}`）；md 预览属性卡不传 schema，不受影响。
- **提交语义**：三种范围都写当前会话的初值（`summary.props`，建完即可填）；「仅此 Agent / 所有会话」额外写模板（scope 分别为 `agent:pi` / `""`）。
- **默认值**：默认「仅此会话」——替换掉当前 `saveToTemplate` 默认 `true` 的危险默认。
- **值的归属**：属性值永远 per-session；模板只控制「定义的可见范围」。

## 待拍板

- 「某个 Agent」的粒度：当前按 `origin`（pi / codex / opencode）。若要按 model 或 persona，scope 编码改 `agent:<origin>:<model>`。
- 既有属性「改范围」的行菜单项（Property menu → Scope）：第二期。

## 与其他原型的关系

- 上游系统原型：`agent/notion-property-agent-card/`（整个属性系统的视觉语言来源）
- 同文件在改的真实任务：`11-06-agent-card-tag-picker`（候选标签 + 计数，`property-list.tsx` 同文件，注意冲突）

## 可交互清单

- `+ Add property` → 浮层打开，名字输入自动聚焦
- 名字为空时 Add 置灰；Enter 提交；Esc 关闭（先关类型菜单）
- 类型按钮 → 下拉菜单（9 种，与 `CreatableTypes` 一致），选中项带 ✓
- 范围三选一：切换即更新选中态；「默认」chip 标注在「仅此会话」
- 重名 / 空名 → 行内错误提示（与真实表单的 "Property already exists" / "Name is required" 一致）
- 提交 → 属性行落到卡片（icon 按类型、值为 —），矩阵实时更新
- 「重置演示」→ 清空新建属性与矩阵
