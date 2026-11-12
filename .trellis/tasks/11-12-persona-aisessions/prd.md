# A1.5 AISessions 集成：persona 属性 + 🎭 分组折叠 + 登场史

## Goal

让 persona 会话在 AISessions 里「正常可见但可区分」：不丢（扫描器本来就收）、不与真项目混排。

## Requirements

- 登场时给会话写 `props.persona = <id>`（agentdata patch 通道）
- 项目分布：`projectPath` 命中人设据点时折叠为「🎭 人设」分组维度（显示 emoji + 人设名，不显示路径）
- 列表行：🎭 标 + 人设名（读 props.persona，无则普通展示）
- 筛选：按 persona 过滤（多选）
- 名册「登场史」= 按 persona 过滤的 AISessions 查询（零新账本）

## Acceptance Criteria

- [ ] `npx vitest run frontend/app/view/aisessions` → passed
- [ ] 登场后 AISessions 项目分布不含 rootdir 路径字符串（折叠生效，探针断言）
- [ ] `wsh session list --json` 中该会话 `props.persona` 非空
- [ ] 名册登场史条数 = 按 persona 过滤的会话数（一致性断言）

## 依赖

A1。
