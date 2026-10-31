# PRD: AI 会话与 Agent 属性系统（Notion 化）

> 设计文档：`design/plans/aisession-notion-properties.md`
> 像素级原型：`design/prototypes/notion-property-agent-card/`
> 开发分支：`feat/aisession-notion-properties`（worktree `../snorkeling-notion-properties`）
> 状态：planning（不进入开发，等评审）

## Background

`SessionSummary` 目前只有 `note` / `tags` / `marked` / `title` / `titleSource` 几个硬编码字段，
前端在 4 处各自维护编辑器（列表行内编辑器、`aisessionnotemodal`、Session Detail 头栏、
`SessionNoteSection`）。Note + Tags 已无法承载「任意属性 + 类型 + 用户/AI 双写 + 卡片展示」的需求。

## Goal

把 Note + Tags 升级为 Notion 式属性系统：

```
PropertySchema（有哪些属性、类型、谁托管）
      → SessionSummary.props（每个会话的值 + source）
      → PropertyRenderer（按 type 渲染 + 编辑）
```

Note / Tags 保留为两个内置属性，旧数据零迁移。

## Requirements

### R1 数据模型

- R1.1 `SessionSummary` 新增 `props`（Go: `map[string]PropertyCell`，JSON `props,omitempty`），与旧字段并存。
- R1.2 `PropertyCell { value, source: user|ai|system, updatedAt }`；旧字段读取时虚拟映射为内置属性（note/tags/starred/title_source）。
- R1.3 `PropertyDef { key, name, type, options, order, scope, aiManaged, aiInstruction, readOnly, formula }`。
- R1.4 v1 类型：text / number / select / multi_select / status / date / person / checkbox / url / formula / relation / created_time / updated_time。
- R1.5 类型推断复用 `frontend/app/view/preview/plugins/md-properties/frontmatter-block.ts` 的 `inferPropertyType()`。

### R2 渲染与编辑

- R2.1 新增单一 `PropertyList` 组件，替换 Note/Tags 区段在 `AgentHoverCard` / `SessionDetailInfoCard` 的渲染。
- R2.2 编辑器按 type 分派：select/status（搜索浮层）、multi-select（chips + 搜索）、date（月历）、checkbox（切换）、text/number/url（inline）、person/relation（选择）、formula/created/updated（只读）。
- R2.3 视觉对齐 Notion light：正文 `#37352f`、属性行高 32px、chip 20px/圆角 3px/12px、浮层 320px/圆角 8px/三段阴影。
- R2.4 卡片窄态：隐藏空值，默认前 5 条 + `+N more`；Detail 信息卡显示全部。

### R3 用户 × AI 双写

- R3.1 用户编辑写 `source=user`；后台 AI 写 `source=ai`；系统派生只读。
- R3.2 复用 `pkg/aisessions/metagenerate.go` + `titleautogen.go` 的 worker 骨架，新增按 schema 生成属性的能力。
- R3.3 `source=user` 的值默认 skip，`Force=true` 才覆盖；覆盖前捕获快照，给 10s Undo。
- R3.4 AI 提议的新属性先进 Suggested，不自动扩散。

### R4 Agent Icon

- R4.1 page icon 解析优先级：block meta `agent:emoji` → provider persona → 品牌 Logo（复用 `getAgentIcon()`）。
- R4.2 icon 属于 page icon，不进入属性列表。

## Non-Goals

- 不做 Rollup / Files & media / Email / Phone / Button / 自定义 formula 表达式。
- 不改旧字段语义；不强制迁移历史会话数据。
- 不做深色主题（原型只复刻 Notion light）。
- 不做真实拖拽排序（v1 用 order 字段 + 菜单调整）。

## Acceptance Criteria

- [ ] `SessionSummary.props` 读写贯通：旧字段虚拟映射正确，写入不破坏旧客户端。
- [ ] `PropertyList` 在 AgentHoverCard / SessionDetailInfoCard 替换 Note/Tags 区段，无功能回归。
- [ ] 13 种 v1 类型至少覆盖：text/number/select/multi_select/status/date/checkbox/url 可编辑，formula/created/updated 只读。
- [ ] 卡片窄态显示前 5 条 + `+N more`，展开可见全部。
- [ ] AI 生成属性：`source=user` 默认不被覆盖；`Force` 覆盖后有 Undo。
- [ ] page icon 在 emoji / block override / 品牌 Logo 三级之间正确切换。
- [ ] 前端 `npx tsc --noEmit` 无新增错误；相关单测全绿。
- [ ] 设计文档与原型 README 相互引用，`__REVIEW_GUIDE__.md` 状态同步。

## Phasing

| 阶段 | 内容 |
|---|---|
| P0 | props 只读映射 + 卡片属性行渲染（前端） |
| P1 | 内置属性编辑统一（note/tags/starred）+ 单一 PropertyList |
| P2 | AI 属性生成 + Suggested + source=ai + Undo（复用 gen-backend） |
| P3 | 自定义 schema（wconfig）+ 新建/改名/换类型/排序/删除 |

## Notes

- 复杂任务，`design.md` / `implement.md` 已按设计文档章节拆分。
- 本任务在 worktree `../snorkeling-notion-properties` 开发，`main` 不被直接改动。
