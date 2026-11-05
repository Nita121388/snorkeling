# 卡片信息架构（A）

> 父任务：`11-05-overview-board-v2`；技术设计见父任务 `design.md` §2.1–§2.4。

## Goal

看板卡片从「色点 + 块标题」升级为「agent 身份 + 状态语义 + 内容预览」：

```
🦊  重构 auth 中间件依赖链                    12m
⏺ Working 3m   Claude   snorkeling
正在梳理 auth 中间件的依赖链，计划先拆分 session 校验逻辑…
✎ 先跑类型检查再动存储层
```

## Requirements

- R1 头像：`getAgentIcon(provider, { meta, sessionId, personas, sessionEmojis })`，
  emoji → 定宽 13px；logo → 品牌色；无 provider → robot 兜底。
- R2 标题：agent 块用会话标题链 `summary.title → note → projectName → "Provider · tab"`，
  **不得**出现 `Terminal`；非 agent 块保持 `blockTitle()`（末尾补 cwd basename 兜底）。
- R3 状态：复用 `.session-overview-agent-status` chip（icon + label + elapsed + ack 语义），
  与列表行同一实现（抽公共组件）；无 AgentStatus 的块显示视图名（muted 文案）。
- R4 辅助信息：provider 展示名 + 项目名（basename）+ tab 名（项目名缺失时）。
- R5 内容：preview = 最后一条可读消息（1 行 clamp）；note 单独一行（`✎` 前缀，空则整行省略）。
  note 不再抢 preview 的位置（现状 `getPreview` 先吃 note，导致卡片只有 note 没有对话内容）。
- R6 卡片整体仍是 `<button>`，点击打开会话；chip 点击只 ack（`stopPropagation`），与列表一致。

## Acceptance Criteria

- [ ] 卡片有 avatar（emoji 或 logo）、标题、age、状态 chip、预览；有 note 时显示 note 行
- [ ] agent 卡片标题不出现 `Terminal`；未知 provider 不渲染空 chip
- [ ] 列表视图渲染与行为零变化（既有真机断言全绿）
- [ ] 纯函数单测：标题链 4 条分支、provider 文案、项目名 basename、age 格式

## 非目标

- 不改 `overviewViewModeAtom`、不加视图切换、不做 Gantt。
- 不引入新的 provider→图标/名称权威表（provider 文案表只用于展示名，未知值原样 title-case）。
