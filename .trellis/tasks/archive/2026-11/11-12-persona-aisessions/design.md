# A1.5 AISessions 集成 — 技术设计

> 设计总稿：`design/plans/persona-system.md` §5.5
> PRD：`prd.md`。本文件补「落地口径」，代码事实已核对（2026-11-12）。

## 1. 代码事实（已核对）

| 事实 | 位置 |
|---|---|
| 会话列表 RPC：`AISessionsListRequest/Response`，含 `ProjectPaths`（配 `IncludeProjectPaths`） | `pkg/service/aisessionsservice/aisessionsservice.go:35-66` |
| 会话摘要已有 props：`Props map[string]AgentPropValue` | `pkg/wshrpc/wshrpctypes.go:682`；Go 扫描侧 `pkg/aisessions/types.go:103` |
| props 写路径已存在：`wsh agent card set --prop k=v`（agentdata patch，dry-run/expected-hash 纪律） | `cmd/wsh/cmd/wshcmd-agent-card.go`、`pkg/agentdata/patch.go` |
| 前端分组：`groupSessionsByProject` 按 `basename(projectPath)` 分桶，未归类沉底 | `frontend/app/view/aisessions/utils.ts:376` |
| `pkg/persona.List(root)` 已可给全量 id/name/emoji/role | `pkg/persona/scaffold.go`（A1） |

## 2. 边界

**做**：persona 会话在 AISessions 的可见性 —— 名册数据下发、🎭 分组折叠、行标 + 人设名、按 persona 筛选、登场史口径。

**不做**：
- 登场（launch 写 props.persona / block meta `persona:<id>`）→ **A3**；A1.5 只消费 `props.persona`
- 名册 Block `persona://` UI → A4
- 新的 props 写路径 → 复用 `wsh agent card set --prop persona=<id>`（PRD「登场时写 props.persona」的兑现方式 = A3 launch 管线调用既有命令，零新写通道）
- 服务端 props 值过滤 → 先客户端过滤（见 §5）

## 3. 判定规则（唯一真相）

1. **会话↔persona 的归属**：`summary.props.persona`（显式，人/AI 可改）。
   分组折叠的**显示名**用名册；归属不用路径猜。
2. **路径命中据点 → 折叠**（PRD 原文）：`projectPath` 以 `<personaRoot>/<id>` 为前缀
   （大小写按平台）且 `<id>` 在名册里 → 该分组按 persona 维度展示：组名 `🎭 <name>`，
   不显示路径。判断需要的 `personaRoot` + 名册由后端下发（§4）。
   - 两机制并存的理由：折叠解决「据点伪项目混排」（后果 A），props.persona 解决
     「哪个会话是哪个人设的」（行标/筛选/登场史）。登场后两者一致。

## 4. 后端

`AISessionsListResponse` 增加两个可选字段（`IncludeProjectPaths` 时一并带出，不新增 flag）：

```go
PersonaRoot string                 // 本次解析的 persona 根目录
Personas    []persona.Persona      // pkg/persona.List 结果（去 persona.local 等机器字段）
```

- `pkg/aisessionsservice` import `pkg/persona`（纯标准库，无环）
- **扫描缓存**：`persona.List` 每次读全部 persona.json，50 人设 ≈ 50 次小文件读；
  服务内做 5 秒 TTL 缓存（mtime 无关，简单优先；A4 如有名册 Block 再升级事件化）
- 失败降级：rootdir 不可读 → `Personas=[]`、`PersonaRoot=""`，前端当无 persona 处理（不炸列表）
- `frontend/types/gotypes.d.ts` 同步（`npx tsc` 基线 47 不增）

## 5. 前端

1. **分组**：`groupSessionsByProject(sessions, descending, compare, matchedKeys, personaCtx?)`
   - `personaCtx = { root: string; byId: Map<id, Persona> }`
   - 命中（§3.2）→ 桶 key = `persona:<id>`（防与真项目同名碰撞），`name = "🎭 " + persona.name`，
     组头不渲染路径
   - 未命中照旧；纯函数可单测（vitest）
2. **行标**：列表行 props.persona 非空 → 🎭 + 人设名 chip（读 byId；查不到显示裸 id）
3. **筛选**：persona 多选 chip（来源 = 当前列表内出现过的 props.persona 值 ∪ 名册），
   客户端过滤 `props.persona ∈ 选中集`；空选 = 不过滤
   - 为什么客户端：列表行已在客户端全量持有（分页由后端 limit + since/before 管），
     A1.5 规模（≤ 选中集几十人设 × 当前列表行）无性能问题；服务端 props 值过滤
     需要索引改动，留给 A4 若有真实需求再上（记入 A4 的 PRD 备选）
4. **登场史口径**（供 A4 名册消费 + 本包 AC）：`countSessionsOfPersona(personaId) =
   当前列表行 props.persona === personaId 的条数`；A4 只是把同一查询挂到名册详情

## 6. 兼容与回滚

- 响应加可选字段：旧前端忽略；新前端对旧后端（字段缺省）按无 persona 降级
- 回滚 = revert 单个 commit；无数据迁移
- A3 未落地前，`props.persona` 只能由人/AI 经 `wsh agent card set` 写 → 分组折叠
  仍按路径命中生效（据点下开会话即折叠），行标/筛选对无 props 会话不显示

## 7. 开放决策（留给签字人）

| # | 决策 | 建议 |
|---|---|---|
| D1 | `Personas` 字段挂在 `IncludeProjectPaths` 还是独立 flag | 建议挂（少一个 flag；名册很便宜） |
| D2 | 缓存 TTL | 5s（够便宜、够新鲜；可改常量） |
| D3 | persona 筛选 chip 放筛选栏哪一层 | 与 source/projects 同层（现有 chip 列尾部） |
