# AI Sessions：筛选结果双向补带（父 ⇄ 子）+ 精确筛选开关

> 状态：◐ 落地中（后端 + 前端已实现，待真机联调）
> 关系：**在 `.trellis/tasks/10-26-aisessions-parent-attach-grouping/design.md` 之上做增量**。那边定稿的「子命中 → 拉回父」已并入本文实现（`Attached="parent"`）；它的「异目录分组归位 / PathChip」仍未实现。
> 任务：`.trellis/tasks/10-27-aisessions-filter-context-attach/`
> 镜像源：`pkg/aisessions/context_attach.go`、`pkg/aisessions/sqlite_index.go`、`frontend/app/view/aisessions/{aisessions.tsx,session-row.tsx,filter-panel.tsx,session-tree.ts}`
> 最后同步：2026-10-27

---

## 1. 一句话需求

> 结果里有子代理 → 把父代理带出来；结果里有父代理 → 把子代理带出来；另外要能一键关掉，只看精确命中。

三种状态，不是三种算法：

| 模式 | 用户看到 | 内部 |
|---|---|---|
| **精确**（严格） | 只有自己满足筛选条件的会话 | 关闭补带，= 今天的行为 |
| **智能**（默认） | 命中行 + 为了父子关系带出来的上下文行（灰显） | 双向补带 |
| （可选）**只带子代理** | 命中的父展开它的子代理，命中子不回填父 | 只做下行 |

---

## 2. 复用已有设计，只加两点

10-26 已定：

- `SessionSummary.Attached bool` —— 请求期派生字段，不落库；
- `attachParentContext(rows, opts)` —— 把缺失的父从「结果集 → sqlite `IN` → 文件推导」三级来源找回来；
- 调用点在 `limit` 之后，attached 行不占分页额度；
- `ExcludeProjects` 硬生效：父被排除就不回填；
- 前端 `matchedKeys` 构造时排除 `attached` 行。

**本文增量 1：把 `Attached` 扩成带来源的枚举**，一次覆盖上下两个方向：

```go
// Attached 为空表示本行自身命中筛选。
// "parent" = 因为某个命中子会话需要父可挂而被带出（10-26 已有）。
// "child"  = 因为某个命中父会话需要展示它的子代理而被带出（本文新增）。
Attached string `json:"attached,omitempty"`
```

> 已有设计里是 `bool`。改成 string 是**纯向后兼容**的破坏面最小改法：JSON 里
> `true` 改成 `"parent"` 只是新字段形态，前端还没落地（10-26 仍是 planning）。
> 如果想保持 bool，就再加一个 `AttachedFrom string`，二选一，不要两个都加。

**本文增量 2：新增下行补带 + 模式开关。**

---

## 3. 后端

### 3.1 选项与协议

`ListOptions` / `SearchOptions`：

```go
// AttachMode 控制筛选结果是否按 parentKey 补齐上下文。
// ""/"off" = 精确（默认，旧行为不变）；"both" = 双向（UI 默认）；
// "children" = 只带出子代理；"parent" = 只回填父。
AttachMode string

// AttachMaxRows 限制带出的上下文行总数，0 用默认值 500。
AttachMaxRows int
```

service 层：`AISessionsListRequest` / `AISessionsSearchRequest` 各加同名字段
（`attachMode`、`attachMaxRows`），透传到 `ListOptions`。

**默认 `off`**：不传就是今天的行为，CLI / 旧前端 / 其他页面零影响。UI 显式传 `both`。

### 3.2 现有 `attachParentContext` 重构为双向

保留 10-26 的三级父查找逻辑，外面包一层调度：

```go
const (
    attachMaxChildrenPerHit = 50   // 一个父最多带出多少个子代理
    attachMaxRowsDefault    = 500
)

// attachContext 是 10-26 attachParentContext 的扩展版：先回填父，再带出子。
// 只读；不改 rows 里除 Attached 之外的字段。
//
// allRows 是过滤前的全量候选（sqlite 快路径与全量扫描路径都能拿到），
// 用来做内存查子，避免额外 SQL。
func attachContext(
    ctx context.Context,
    rows []SessionSummary,      // limit 之后的命中集
    allRows []SessionSummary,   // 过滤前的全量行（同一批，可能为 nil）
    opts ListOptions,
) []SessionSummary
```

步骤：

```
1. present := map[key] 来自 rows；out := rows
2. 上行（10-26 原逻辑，mode 含 parent 时才跑）
   对每条有 ParentKey 的行，父不在 present 且不在 exclude 列表 → 拉回，Attached="parent"
3. 下行（mode 含 child 时才跑）
   hits := out 里 Attached=="" 的行          // 只给「自身命中」的父带子，不给回填父带子
   children := allRows 按 ParentKey 分组，仅 Kind=subagent|fork
   对每个 hit：
       取其 children，按 updatedAt 降序，最多 attachMaxChildrenPerHit 条
       逐条过硬排除：ExcludeProjects / ExcludeTags 命中 → 跳过
       已经在 present 里的（自身命中的子）→ 跳过，不改 Attached
       否则 → 追加，Attached="child"
4. 总数上限 attachMaxRows（默认 500），超出按 updatedAt 降序截断，
   响应里回传 AttachTruncated bool
5. 排序保持「命中行在前、attached 行在后」即可；前端 buildSessionTree 自己排序，
   数组顺序不影响成树（10-26 已论证）
```

三条实现约束：

1. **下行必须用 `allRows` 而不是 `rows`**：命中父的子代理几乎永远不会自己命中筛选，只从 `rows` 里找会全都找不到。
2. **`limit` 仍然只裁命中集**：`limit=200` = 最多 200 条搜索结果，上下文行在截断之后追加，不占额度（否则一个父带 107 个子代理就把列表挤爆——本机实测单父最多 107）。
3. **只给 hit 带子，不给 attached 父带子**：否则「子命中 → 回填父 → 父再带出它全部子代理」会波及一批和搜索词无关的兄弟，噪音太大。

### 3.3 调用点（与 10-26 相同，只是函数换名）

- `Manager.ScanListResult` → 缓存命中分支与全量扫描分支都要过 `attachContext`；
- `Manager.Search` 的 sqlite 早返回分支；
- `cachedScanListWithDistribution` / `sqlite_index.ListWithDistribution` —— 注意这两处现在是**两份重复过滤循环**，先抽 `applyListFilters` 再挂 attach，否则行为必然漂移。

### 3.4 单测（`pkg/aisessions/context_attach_test.go`）

| 用例 | 断言 |
|---|---|
| `off` | 输出与输入逐行相等，无 `Attached` |
| `both`：子命中（父在 allRows 中） | 父追加且 `Attached="parent"`，父的其它子不出现 |
| `both`：父命中 | 全部直接子代理/fork 追加且 `Attached="child"`，孙级不带 |
| `both`：父命中且某个子也命中 | 该子保持 `Attached==""`，不重复 |
| `children`：子命中 | 不回填父 |
| `parent`：父命中 | 不带出子 |
| `limit=1` 有 5 个命中 | 只留 1 个命中 + 它的上下文 |
| 单父 120 个子 | 最多带 50 个，按 updatedAt 降序 |
| `ExcludeTags` 命中某子 | 该子不被带出，父行仍在 |
| `ExcludeProjects` 命中父 | 父不回填，子行退回孤儿 |
| 孤儿（parentKey 指向不存在） | 不造行 |
| `missing=1` 行 | 不参与双向补带 |

---

## 4. 前端

### 4.1 命中集推导

不需要新协议字段：**`matchedKeys = rows.filter(r => !r.attached).map(r => r.key)`**，
无筛选时传 `undefined`（`buildSessionTree` 的 `allMatched` 语义）。

`utils.ts:359` 和 `session-group.tsx:179` 现在都传 `undefined`，改成传真实集合。
`matchedChildCount` / `matched`（`session-tree.ts:122-124`）和 `session-row.tsx:237`
的 `1/6` 徽标随即自动生效，无需改动。

### 4.2 会话行

| 行类型 | 视觉 | tooltip |
|---|---|---|
| `attached="parent"` | 次要文字色 + `fa-link` | 「上下文父会话（未命中本次筛选）」 |
| `attached="child"` | 次要文字色 + `fa-sitemap` | 「子代理（未命中本次筛选，父会话命中所致）」 |
| 自身命中且是父 | 徽标 `命中子数/子总数`（如 `1/6`），无则纯 `+N` | 现状 |
| 孤儿（父找不到） | `fa-link-slash` | 「父会话不可用」 |

不做灰度底色（会和选中态、运行态底色打架），只加小图标 + 次要色。

### 4.3 自动展开

替换 `aisessions.tsx:1509-1531` 的 `matchedChildParentKeys` 反推：

```ts
const autoExpandKeys = useMemo(
    () => (matchedKeys == null ? [] : [...collectParentsOfMatches(tree, matchedKeys)]),
    [matchedKeys, tree]
);
```

`collectParentsOfMatches`（`session-tree.ts:165`）就是为这个语义写的，现在没人用。
保留现有的 `suppressedAutoExpandRef`（用户手动收起优先）与「筛选条件变化时清空抑制集」。

注意：`attached="parent"` 的父行必须在自动展开集合里 —— 它进来就是为了让命中子被看到。

### 4.4 选区 / 全选 / 复制

- **全选只选命中行**：`selectAll` 过滤 `!s.attached`（10-26 已定）。
- 手动点击上下文行可加入选区（看得见就能复制）。
- 复制按钮文案区分：`复制 5 个命中 ID`；选区内含上下文行时 → `复制 8 个（含 3 个上下文）`。
- 默认「复制 ID」只输出命中行，上下文行走二次菜单/Shift 点击 —— **待确认（§7）**。

### 4.5 开关

筛选面板（`filter-panel.tsx`）新增「包含上下文」三项：

```
○ 精确：只显示命中
● 智能：命中父带出子代理，命中子补带父   ← 默认
○ 只带出子代理：命中父展开子，命中子不回填父
```

- 落盘 `localStorage["aisessions.attachMode"]`，默认 `both`；
- 切换走现有 200ms debounce 的 `loadSessions`（`aisessions.tsx:1664`），无需新增刷新链路；
- 「精确」= `off`，一键回到旧行为，用于消除惊吓。

### 4.6 计数

- 列表顶部结果数只数命中行：`12 results`，有上下文时追加 ` (+31 上下文)`，点击「上下文」可临时隐藏（纯前端过滤，不改请求）。
- 组头徽标 `hitCount` / `attachedCount`：10-26 已定，本文不改。
- `+N` 子会话徽标的 tooltip 补一句「当前结果集内」。

---

## 5. 风险

| 风险 | 处理 |
|---|---|
| 「智能」模式下 tag/date 筛选变得不严格，用户误以为筛选失效 | 上下文行明显灰显 + 标签 + 顶部「+N 上下文」可点击隐藏；面板开关一键回精确 |
| 一个父 107 个子代理全带出，列表爆炸 | 每父 50 + 全局 500，超出截断并提示「已截断」 |
| 补带把被 `ExcludeTags` 排除的内容带回来 | exclude 硬边界：补带时二次校验 exclude 侧 |
| 60s 自动刷新导致 `matchedKeys` 抖动、自动展开被重置 | 与 `sessions` 同一响应原子更新；自动展开按签名依赖（现有机制） |
| 远程 connection | 同一 service 路径，远端计算，无额外改动 |
| 详情面板 / resume / delete | 上下文行是真实会话，无需特判 |

---

## 6. 落地顺序

| 阶段 | 内容 | 验证 |
|---|---|---|
| P1 | 抽 `applyListFilters`，消除 `sqlite_index.go:1495` 与 `manager.go:270` 的重复过滤 | 现有测试全绿 |
| P2 | `AttachMode`/`AttachMaxRows` 协议 + `attachContext`（含已有上行逻辑） | 单测表驱动 |
| P3 | 三处调用点接线 + 截断标记 | 手测 RPC |
| P4 | 前端 `matchedKeys` → 建树 → 徽标 → 自动展开 | 「父命中带子」「子命中补父」可视验证 |
| P5 | 上下文行样式 + 计数 + 选区语义 | 交互回归 |
| P6 | 筛选面板开关 + 落盘 | 三档切换正确 |
| P7 | `docs/project/ai-sessions.md` 补事实条目 | 文档对齐 |

P1–P3 后端默认 `off`，P4 之前用户可见行为完全不变。

---

## 7. 需要拍板

1. `Attached` 用 `string`（`"parent"`/`"child"`）还是 `bool` + 新增 `AttachedFrom`？推荐前者（字段少、语义直白，且 10-26 未落地）。
2. 默认模式：`both`（智能）还是先 `off` 灰度？推荐 `both`。
3. 每父 50 / 全局 500 的上下文上限是否合适？（本机实测单父最多 107 个子）
4. 复制语义：默认只复制命中行（推荐）还是全部可见行？
5. 这块是**并入 10-26 任务**（推荐，同一个 `attachParentContext` 的两半）还是新建独立任务？
