# 技术设计：AI 会话父级回填与分组归位

## 1. 现状（代码坐标）

### 后端

| 位置 | 现状 |
|---|---|
| `pkg/aisessions/parent_child.go` | `ClassifyPiSessionFile(sessionsDir, filePath) (parentPath, kind)`、`PiParentKey(source, sessionsDir, filePath) string`。父子关系只由磁盘结构判定 |
| `pkg/aisessions/provider_pi.go:133` | `ProjectPath: strValue(header, "cwd")` —— **自身** cwd |
| `pkg/aisessions/manager.go:237 scanListNow` | 全量扫描 → 内存过滤（`summaryMatchesList` / `projectPathMatchesAny` / `projectPathExcluded` / `summaryMatchesQuery`）→ `sortSummaries` → `limitSummaries` |
| `pkg/aisessions/manager.go:396 cachedScanListWithDistribution` | sqlite 快路径 → `sqliteIdx.ListWithDistribution` → query 过滤 → `limitSummaries` |
| `pkg/aisessions/manager.go:137 Search` | sqlite 命中时**早返回** `sqliteIdx.Search` 结果 |
| `pkg/aisessions/manager.go:202 ScanListResult` | 两条路径的唯一汇合点，`enqueueAutoTitles` 在此调用 |
| `pkg/aisessions/types.go:37` `SessionSummary` | 已有 `ParentKey` / `Kind`；无 `Attached` / `ParentMissing` |

### 前端

| 位置 | 现状 |
|---|---|
| `frontend/app/view/aisessions/utils.ts:251 groupSessionsByProject` | 桶 key = `basenamePath(projectPath)`；桶内 `buildSessionTree` |
| `frontend/app/view/aisessions/session-tree.ts:95 buildSessionTree` | `parentKey` 不在结果集 → 提升为顶层 |
| `frontend/app/view/aisessions/session-group.tsx` | 组头渲染 + `groupCollapsed` localStorage |
| `frontend/app/view/aisessions/session-row.tsx:221` | 行 tooltip 单行 `Path: ...` |
| `frontend/app/view/aisessions/controls.tsx:288 useCopyStatus` | 已有复制反馈 hook，可复用 |
| `frontend/app/view/aisessions/session-detail.tsx:1447` | `projectDirectory` 已算出但只传给 InfoCard |

---

## 2. 数据流（改造后）

```
provider.ListFiles
  └─ SessionFile{ParentPath, Kind}              （已有）
      └─ ParseSummary
          └─ SessionSummary{ParentKey, Kind, ProjectPath=自身cwd}
              └─ SQLite ai_sessions                （不变，无 schema 变更）
                  ↓
        ┌──────── List / Search 请求 ────────┐
        │                                    │
   scanListNow                        cachedScanListWithDistribution
        │                                    │
        └──────────► ScanListResult ◄────────┘
                          │
                  attachParentContext(rows)      ← 新增（唯一入口）
                          │  · 3 级来源找回父
                          │  · 递归上溯（≤4 层，防环）
                          │  · 尊重 ExcludeProjects
                          │  · 上限 50 / 200
                          ↓
                  enqueueAutoTitles(rows)        ← 移到 attach 之后
                          ↓
                     RPC → 前端
                          ↓
                groupSessionsByProject
                  · anchor = 父的 projectPath（回填后几乎总能拿到）
                  · bucket key = 规范化完整路径
                          ↓
                buildSessionTree（现有逻辑，几乎不再走"提升为顶层"分支）
                          ↓
          SessionGroup（组头 PathChip）/ SessionRow（子行 PathChip、灰显 Attached）
```

---

## 3. 后端设计

### 3.1 新字段（`types.go`）

```go
// Attached 表示本行不是本次筛选命中的，而是为了让子会话有父可挂而被拉进来的
// 上下文行。前端据此灰显并排除出批量选择。
Attached bool `json:"attached,omitempty"`

// ParentMissing 表示本行有 parentKey 但父文件已不存在（真孤儿）。父若后来重新
// 出现（例如换机器同步回文件），下次扫描会自然清掉。
ParentMissing bool `json:"parentMissing,omitempty"`
```

不新增 DB 列：`Attached` 是**请求期**概念（同一条会话在筛选 A 下是回填行，
在无筛选下是普通行），落库就是错误建模。`ParentMissing` 由列表期计算。

### 3.2 `attachParentContext`

新文件 `pkg/aisessions/parent_attach.go`：

```go
const (
    attachMaxDepth      = 4
    attachMaxFileLookup = 50
    attachMaxRows       = 200
)

// attachParentContext 把 rows 里缺失的父会话找回来，追加到结果并标记 Attached。
// 只读：不改 rows 的字段（除 Attached/ParentMissing），不改 dist。
//
// 调用点必须保证：rows 已经是 limit 截断后的最终结果，且已带 meta（note/tags）。
func (m *Manager) attachParentContext(ctx context.Context, rows []SessionSummary) []SessionSummary
```

实现步骤：

1. `present := map[key]SessionSummary`（rows）。
2. 反复迭代直到无新增（等价递归上溯）：
   - 对 `present` 里每条有 `ParentKey` 的行，若 `ParentKey` 不在 `present` 且不在
     `excludedKeys`：加入 `missing` 集合。
   - 若 `missing` 为空或深度超过 `attachMaxDepth`（或 `len(attached) >= attachMaxRows`）→ 跳出。
   - 解析 `missing`：
     a. **内存**：本次全量 `summaries`（若调用方有）——`ScanListResult` 可把
        `refreshAllSummaries` 的产物传进来，最省。
     b. **sqlite 批量**：`idx.GetByKeys(ctx, keys)`（新增一个 `SELECT ... WHERE key IN (?,?,...)`，
        复用已有的 `scanSummaryFromRow` 映射，返回 `map[string]SessionSummary`）。
     c. **文件推导**：对仍缺失的 key，用子行的 `FilePath` 走
        `ClassifyPiSessionFile` 得到父文件路径，再 `StableKey` + `ParseSummary`；
        受 `attachMaxFileLookup` 限制。
   - 命中的父：`p.Attached = true`，加入输出与 `present`；其 meta（note/tags）由
     `sqliteIdx.ApplyMeta` 补（b 路径已含；c 路径需要补一次）。
   - 命中的父若 `projectPathExcluded(p.ProjectPath, excludes)` → 不加入，父 key 进
     `excludedKeys`，其子行留下来走孤儿路径。
3. 对最终 `rows` 中「`ParentKey` 非空且父确实找不到」的行设 `ParentMissing = true`。
4. 排序：父行插到**其子行之前**；同层按 `sortSummaries` 既有顺序。实现上不做整体
   重排，而是在返回时把 attached 行加到 `rows` 头部并保持「父先于子」的相对顺序
   由前端 `buildSessionTree` 负责，后端只需保证 attached 行**不被 limit 挤掉**。
   → 结论：后端返回 `rows + attached`（attached 追加在尾部即可），前端构树时父行
   位置由排序决定，与数组顺序无关（`buildSessionTree` 自己 sort）。**这一点要写进注释**。

### 3.3 调用点

```go
// manager.go
func (m *Manager) ScanListResult(...) (ScanListResult, error) {
    ...
    summaries = m.attachParentContext(ctx, summaries)   // ← 新增
    m.enqueueAutoTitles(summaries)                      // ← 移到这里之后
    ...
}

// 搜索的 sqlite 早返回分支
func (m *Manager) Search(...) ([]SessionSummary, error) {
    if ... {
        if err == nil && scanErr == nil && hasScan {
            return m.attachParentContext(ctx, summaries), nil    // ← 新增
        }
    }
}
```

`attachParentContext` 内部自己拿 `ExcludeProjects` → 需要把 `opts` 传进来：

```go
func (m *Manager) attachParentContext(ctx context.Context, rows []SessionSummary, opts ListOptions) []SessionSummary
```

### 3.4 路径过滤口径（R3）

`scanListNow` / `sqliteIdx.ListWithDistribution` 的过滤条件改判 **effective path**：

```go
// effectiveProjectPath 返回该会话归属的目录：优先父会话（同一次扫描里已知）的
// projectPath，退化为自身 projectPath。
//
// 用途仅限"分组与筛选"，不写回 summary.ProjectPath。
func effectiveProjectPath(s SessionSummary, byKey map[string]SessionSummary) string
```

问题：`scanListNow` 的过滤是**单趟**的，过滤时父可能排在子之后。解决：

- `scanListNow`：先建 `byKey`（全量 `summaries`，过滤前）→ 再一趟过滤，过滤时用
  `effectiveProjectPath(summary, byKey)`。父在**同一次全量扫描**里必然存在（除非父
  文件已删），所以能算准，不需要额外 IO。
- `cachedScanListWithDistribution`（sqlite）：`ListWithDistribution` 里的 SQL 无法在
  过滤时拿到父。两个选择：
   - **B1**：SQL 侧仍按自身 `projectPath` 过滤，随后对结果做一次「父路径补丁」：
     缺失父（被路径过滤挡掉的）如果其 `projectPath` 命中 `Projects` 且不在
     `ExcludeProjects` 中 → 用 `attachParentContext` 拉回。实现简单，且语义正确
     （父如果本来就在选中目录里，拉回来天经地义）。
   - **B2**：SQL 里 `JOIN` 自身表的父行。复杂、要动 schema 索引，且父可能跨 provider。
   → **选 B1**。B1 与 `attachParentContext` 是同一个函数，行为统一。

  注意 B1 的 `dist`：`ListWithDistribution` 的 dist 仍按自身 path 统计 →
   与分组口径存在细微差异（勾选 `E:\a` 时，跑在 `E:\b` 的子会话在 dist 里算 `E:\b`）。
   这是**可接受**的：dist 是导航树，`E:\b` 独立出现在树上是事实（那些会话的 cwd 真在
   那里），用户若只想看 `E:\a`，勾上 `E:\a` 也能把它们带出来。

### 3.5 孤儿判定

`ParentMissing` 只对 `Kind != "" && ParentKey != ""` 的行计算。非 pi provider
（codex / claude / opencode）没有 `ParentKey`，永远 false。

### 3.6 性能

| 场景 | 额外成本 |
|---|---|
| 无筛选、父子都在结果集 | 0（`present` map 命中） |
| 搜索命中子会话 | 1 次 sqlite `IN` 查询（≤ 缺父数） |
| 索引刚重建 / 父文件更新 | ≤ 50 次文件 `ParseSummary`（仅头部 + 首尾行） |
| 父文件已删 | 3 级来源全 miss，0 额外成本，仅打标记 |

`GetByKeys` 走 `key` 主键（`ai_sessions` 的 `key` 是 PRIMARY KEY），O(log n) 每次。

---

## 4. 前端设计

### 4.1 分组（`utils.ts`）

```ts
/** 分组锚点：该会话应该归到哪个目录的组里。 */
export function resolveGroupAnchor(
    session: SessionSummary,
    byKey: Map<string, SessionSummary>,
    depth = 0
): string

/** 规范化分组桶 key：小写 + 统一 `/` + 去尾部分隔符；空 → ""（未归类）。 */
export function normalizeGroupPathKey(path: string): string

export function groupSessionsByProject(sessions: SessionSummary[], descending = true): ProjectSessionGroup[] {
    // 1. byKey
    // 2. anchor + key 分桶（key = normalizeGroupPathKey(anchor)）
    // 3. name = basenamePath(anchor) || UnclassifiedGroupName
    // 4. 组内 buildSessionTree（不变）
    // 5. 组排序：未归类沉底 → 组内最新会话时间倒序 → 同时间按 path 字典序（稳定）
}
```

`ProjectSessionGroup` 增加两个字段：

```ts
/** 组内命中行数（不含 Attached 回填行）；组头徽标用它。 */
hitCount: number;
/** 组内回填行数；> 0 时组头 tooltip 追加「+N 上下文行」。 */
attachedCount: number;
```

`path` 字段语义改为**锚点路径**（完整路径，不再保证等于组内每条会话的
`projectPath`）—— 组头 PathChip 复制它。

### 4.2 构树（`session-tree.ts`）

不需要改逻辑，只需确保：

- `Attached` 行参与成树（它们是真正的父）。
- `matchedChildCount` 照旧按 `matchedKeys` 计算。
- 新增导出 `countAttachedRows(nodes)` 供组头统计（纯函数，好测）。

一个细节：搜索时 `matchedKeys` 由 `aisessions.tsx` 算出（命中集合）。回填父不被算入
命中，因此 `buildSessionTree` 的 `matched` 为 false → 需要 UI 把它显示成「上下文行」。
**关键**：`aisessions.tsx` 里构造 `matchedKeys` 时，若某行 `attached === true` 必须
**排除**，否则灰行会被当成命中。

### 4.3 PathChip（新文件 `path-chip.tsx`）

```tsx
type PathChipProps = {
    /** 要显示与复制的完整路径。 */
    path: string;
    /** tooltip 附加行（子会话用：父目录）。 */
    secondaryPath?: string;
    /** 覆盖显示名（默认 basename(path)）。 */
    label?: string;
    className?: string;
    /** 行内点击不触发行选中/双击打开。 */
    stopPropagation?: boolean;
    /** 是否显示图标（组头紧凑模式可关掉）。 */
    showIcon?: boolean;
};
```

- 复制：`navigator.clipboard.writeText` + `useCopyStatus`（`controls.tsx:288`）。
  `navigator.clipboard` 不存在时直接置 `failed`，不 throw。
- tooltip 文案（多行字符串，走 `title` 属性，与现有行 tooltip 一致）：
  ```
  自身: E:\code\LiCASmart\.cache\tmp\wt-head
  父目录: E:\code\LiCASmart
  ```
- 组头用法：`showIcon={false}`，`onClick` 时 `event.stopPropagation()` 以避开折叠。
  （组头是 `<button>`，内部再放 `<button>` 非法 DOM → 组头用 `<span role="button" tabIndex={0} onClick>`。）

**DOM 合法性**：`session-group.tsx` 组头当前是 `<button>`。内部插入 PathChip 会变成
button 嵌套 button（React 不报错但 HTML 非法、点击行为不确定）。方案：把组头
`<button>` 改为 `<div role="button" tabIndex={0} onKeyDown={Enter/Space}>`，内部
PathChip 用真正的 `<button>`。这属于必须一并改的连带修改。

### 4.4 SessionRow（`session-row.tsx`）

- 新增 prop `attached?: boolean`、`parentMissing?: boolean`。
- 子行（`depth > 0`）在标题左侧渲染 PathChip，条件：
  `basename(ownProjectPath) !== basename(groupAnchorPath)`。
  → 需要 `SessionRow` 拿到组锚点。两条路：
  - 由 `renderNode` 传 `groupPath`（`session-group.tsx` 已经能拿到 `group.path`）
  - 或直接在行内比较 `session.projectPath` 与「父行的 projectPath」——
    但行不持有父对象。
  → **选前者**：`GroupedSessionList` / `renderNode` 传 `groupPath={group.path}`。
- 行 tooltip 的 `Path:` 改双行（自身 / 父目录 = 组锚点，若不同）。
- `attached` 行：`opacity-70` + 标题右侧 `fa-link` + tooltip 追加
  「上下文父会话（未命中本次筛选）」。
- `parentMissing` 行：`fa-link-slash` + tooltip「父会话文件已删除」。
- `attached` 行不参与「全选」：`aisessions.tsx` 的 selectAll 过滤 `!s.attached`。

### 4.5 SessionDetail（`session-detail.tsx`）

标题右侧（`summary.title || summary.id` 那个 div 之后）插入 PathChip：

```tsx
{projectDirectory ? (
    <PathChip
        path={projectDirectory}
        secondaryPath={summary.parentKey ? parentProjectPath : undefined}
        className="shrink-0"
    />
) : null}
```

`parentProjectPath`：详情里已能拿到会话列表（`sessions` prop 或 store），用
`parentKey` 查一次即可；查不到就不传。头栏 `h-[46px]` 高度不变，chip 用 `text-[11px]`。

### 4.6 存储 key 迁移（`session-group.tsx`）

```ts
export const groupCollapsedStorageKey = "aisessions.groupCollapsed.v2";
```
旧 key 不读、不删（无害）。`writeCollapsedGroups` 写新 key。

---

## 5. 契约变化汇总

| 层 | 变化 | 兼容性 |
|---|---|---|
| `SessionSummary` JSON | `+attached`, `+parentMissing` | 纯新增，旧前端忽略 |
| SQLite schema | 无变化 | — |
| `List` / `Search` 结果 | 可能多出 `attached=true` 的行；`limit` 可能被略微超出（≤200） | 前端需感知；旧前端会当普通行显示（可接受降级） |
| `ProjectSessionGroup.path` | basename → 完整锚点路径 | 仅前端内部类型，`filter-panel` 不依赖它 |
| localStorage | `aisessions.groupCollapsed.v2` | 旧折叠状态丢弃一次 |

---

## 6. 测试设计

### 后端（`pkg/aisessions/parent_attach_test.go`）

构造 fixture 目录树：

```
sessions/
  --P--a--/p1.jsonl                                  cwd = P:\a
  --P--a--/p1/<u1>/run-0/session.jsonl                cwd = P:\b        ← 异目录子会话
  --P--a--/p2.jsonl                                  cwd = P:\a
  --P--a--/p2/<u2>/run-0/session.jsonl               cwd = P:\a
  --P--a--/p3.jsonl                                  （父文件不存在，仅有目录）
  --P--a--/p3/<u3>/run-0/session.jsonl
```

用例：

1. `TestAttachParentInResultSet` — 无额外查询，父子都在，`Attached` 全 false。
2. `TestAttachParentMissingFromFilteredRows` — 只喂子行，父被找回，`Attached=true`。
3. `TestAttachRespectsExcludeProjects` — `ExcludeProjects=[P:\a]` → 不回填，子行
   `ParentMissing=false`（父存在但被排除）——需要一个独立标志或直接只验证「没有父行」。
4. `TestAttachParentFileGone` — `p3` → 子行 `ParentMissing=true`。
5. `TestAttachCycleTerminates` — `p1↔p2` 互指 → 函数返回、不超时、不重复。
6. `TestAttachFileLookupCap` — 60 个子行父都不在索引 → 只回填 50 个。
7. `TestEffectiveProjectPath` — 异目录子会话的 effective path = 父 path。
8. `TestProjectPathFilterIncludesCrossDirChildren` — `Projects=[P:\a]` 时异目录子会话
   **在**结果里。

### 前端

- `utils.test.ts`
  - `resolveGroupAnchor` 三层（父在 / 父不在 / 自指）
  - `normalizeGroupPathKey`（大小写、分隔符、尾部斜杠、空）
  - `groupSessionsByProject`：同名不同路径分两组；异目录子会话归父组；
    `hitCount` / `attachedCount` 正确
- `session-tree.test.ts`：`attached` 行正常成树；`matchedChildCount` 不含 attached
- `path-chip.test.tsx`：渲染 basename、tooltip 双行、点击复制、失败降级、
  `stopPropagation` 生效
- `session-row.test.tsx`：`attached` 灰显 + 图标；`parentMissing` 断链图标；
  chip 只在 basename 不同时出现

### 手测清单

1. LiCASmart 的 `Smart_V2.0.0.18168` 子会话归位（AC1）
2. 搜索只命中子会话（AC2）
3. 两个同名目录分组独立（AC3）
4. chip tooltip / 复制（AC4/AC5）
5. `ExcludeProjects` 排除父目录（AC6）
6. 删父文件后刷新（AC7）
7. 批量全选不含灰行（AC9）

---

## 7. 取过的方案与放弃理由

| 方案 | 放弃原因 |
|---|---|
| 把子会话的 `ProjectPath` 直接改成父的 | 丢失「子代理在哪个目录跑」的事实；污染索引；后续要按真实 cwd 做功能就没了 |
| 只在前端按 `parentKey` 找父（不做后端回填） | 父被 query/路径过滤/limit 挡掉时前端拿不到它，仍会分离 |
| 前端再发一次 RPC 拉父 | 每请求可能多 N 次往返；父行还会晚到导致列表跳动 |
| 后端 SQL `JOIN` 父行做过滤 | 需要动索引与 SQL 构造，跨 provider 不通用；B1 用同一套回填逻辑更省 |
| 新增 `groupProjectPath` 落库字段 | 请求期概念，落库会随筛选变化而错；回填后不再需要 |
| 组头保留 `<button>` 内嵌 chip | HTML 非法、点击行为不确定；改为 `div[role=button]` |

---

## 8. 回滚

改动分三层，任一层可独立回滚：

1. **后端 attach**（`parent_attach.go` + 2 处调用）：删调用即回到现状，前端有兜底。
2. **前端分组 key**（`utils.ts` 两个函数）：改回 `basenamePath` + 单组 key 即可。
3. **PathChip**：独立组件，删渲染点即可。

无 DB migration → 无数据回滚需求。
