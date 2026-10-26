# Design: AI 会话筛选 — 路径多选 + 排除查询

## 0. 一句话结构

后端统一为「前缀集合 + OR 匹配 + 否定剔除」，前端把「浏览位置」与「选中集合」拆成两个状态；
Phase A 只加 `Projects`，Phase B 在同一个匹配器上再加 `ExcludeProjects` / `ExcludeTags`。

---

# Phase A — 路径多选

## A1. 后端契约（`pkg/aisessions/types.go`）

```go
// ProjectFilterOther 是「空 / 无法识别 projectPath」桶的哨兵值，
// 与前端 PathFilterOtherRoot 取值必须一致。
const ProjectFilterOther = "__other__"

type ListOptions struct {
    Project         string   // 兼容：单值前缀（旧调用方）
    Projects        []string // 包含：前缀集合并集（新增；非空时优先于 Project）
    Since           int64
    Before          int64
    Limit           int
    Marked          string
    TagFilters      []string
    TagPresence     string
    Refresh         bool
}
```

`SearchOptions` 增 `Projects []string`。

**归一化**（`pkg/aisessions/tags.go` 同目录新建 `projects.go` 或放在 `index.go` 匹配函数旁）：

```go
// normalizeProjectFilters: TrimSpace → TrimRight(p, `/\`) → 去空 → 保序去重（大小写不敏感）
// 哨兵值 __other__ 原样保留，不参与 TrimRight。
func normalizeProjectFilters(in []string) []string
```

## A2. 匹配语义

```go
// 包含：空集合 = 不限制；否则任一前缀命中即 true。
func projectPathMatchesAny(projectPath string, projects []string) bool {
    if len(projects) == 0 { return true }
    for _, p := range projects {
        if p == ProjectFilterOther {
            if projectPathIsOther(projectPath) { return true }
            continue
        }
        if projectPathMatches(projectPath, p) { return true }
    }
    return false
}

// 空 / 无法识别：复用前端 extractRootOfPath 的口径。
//   "" → true；绝对路径（/ 或 X:\ 或 ~/）→ false；其余相对路径 → true。
func projectPathIsOther(projectPath string) bool
```

`projectPathMatches`（`index.go:408`）**不改**：大小写不敏感 + 分隔符边界，父目录覆盖子目录，不误伤同名前缀兄弟。

**有效前缀集合**：

```go
func effectiveProjects(opts ListOptions) []string {
    if len(opts.Projects) > 0 { return normalizeProjectFilters(opts.Projects) }
    if strings.TrimSpace(opts.Project) != "" { return normalizeProjectFilters([]string{opts.Project}) }
    return nil
}
```

`Projects` 非空时**完全覆盖** `Project`（不合并，避免语义二义）。

## A3. 分布（`ProjectPaths`）

现有不变量保持不变：dist 在「非 project 条件（source / date / marked / tags）」之后、project 过滤之前聚合，
即 **包含型路径选择不影响 dist**（用户永远能看到全部目录与真实计数，才能继续多选）。

Phase B 的排除会打破这一点（排除必须在 dist 之前），见 B3。

## A4. RPC（`pkg/service/aisessionsservice/aisessionsservice.go`）

- `AISessionsListRequest` 增 `Projects []string json:"projects,omitempty"`；`Project` 保留
- `List` / `Tags` 透传 `Projects`（`Tags` 现有 `Project` 透传一并保留）

## A5. 前端状态拆分（`aisessions.tsx`）

现状：`pathFilterAtom` 既当浏览位置、又当过滤条件（`pathFilterToPrefix` → `project`）。

拆为三个：

```ts
pathFilterAtom = jotai.atom<PathFilter>(DefaultPathFilter)   // 浏览位置（面包屑/chips/计数导航）
pathSelectionsAtom = jotai.atom<string[]>([])                // 包含：已选前缀集合（可含 "__other__"）
pathExcludesAtom = jotai.atom<string[]>([])                  // 排除：B 阶段启用
```

`PathFilter` 类型不变，语义收窄为「浏览位置」。`pathFilterToPrefix` / `pathFilterEqual` /
`extractPathChildren` / `extractPathRoots` 全部继续服务浏览，不参与过滤。

**`PathFilterOtherRoot` 取值改为 `"__other__"`**（`types.ts`），与 Go `ProjectFilterOther` 一致。
`otherRootMatcher` 与 `loadSessions` 中的本地后置过滤（`aisessions.tsx:358`）删除；
`path-filter.test.ts:184` 对应用例改为「哨兵由后端处理」的断言。

## A6. UI（`filter-panel.tsx`）

**根行**：`All` 按钮 = 清空 `pathSelections`；每个根 chip **切换选中**（toggle），
选中态：实心圆点 + accent 边框；未选中：现状样式。计数仍来自 dist。

**面包屑**：只导航（`setPathFilter`），不改变选中集合。当前浏览层级高亮。

**子目录 chips**（两区）：

```
[ folder-name  (12)  › ]      ← 名称区域点击 = toggle 选中；› 点击 = 下钻
```

- 选中态：`bg-accent/10 text-accent` + 左侧 `fa-check`
- 下钻：`›` 区域 `stopPropagation`，调 `setPathFilter({root, subPath: child})`
- 冗余选择（父已选中时点子目录）：**允许**，chip 显示「已包含」提示（`title="已包含在上级选中目录中"`，样式淡化为选中态），不做静默删除

**已选集合 chip 条**：加入激活条件区，每个前缀一个 chip（复用 `shortenPathForChip`），`onRemove` 取消该选中项。

**Other chip**：以 `__other__` 参与 toggle，显示 `Other (n)`；与真实根同构，不需要特殊 UI。

## A7. 请求组装与竞态校验

`loadSessions`（`aisessions.tsx:302`）：

```ts
const projects = globalStore.get(this.pathSelectionsAtom);
...
project: undefined,        // 不再发送单值
projects,
```

`isCurrentSessionsLoad`（比较 `loadSeq` + 条件快照）追加 `pathSelections` 快照与数组相等比较
（`arraysEqualCI`，大小写不敏感），否则快速连续点选会出现旧响应覆盖新结果的闪烁。

`remoteFilterActive` / `activeFilterCount` / `filterSignature`：用 `pathSelections.length > 0`
和 `pathSelections.join(",")` 替代 `pathFilter.root !== ""` / `pathFilter.root`。

## A8. Phase A 测试

Go：

- 多前缀 OR（两个不相干目录 → 并集）
- 父+子同时选中 → 与仅父一致（幂等）
- 边界：`snorkeling` vs `snorkeling-imgzoom`
- `__other__` 命中空路径、不命中绝对路径
- `Projects` 非空时覆盖 `Project`
- dist 不受包含选择影响
- 两套 Index（`sqlite_index_test.go` / `index_test.go`）

前端：

- toggle 选中/取消；浏览位置变化不改选中集合
- `loadSessions` payload 含 `projects` 且不含 `project`
- `filterSignature` 随选中集合变化

---

# Phase B — 排除查询

## B1. 后端契约

```go
type ListOptions struct {
    ...
    ExcludeProjects []string // 排除：命中任一前缀（含 __other__）即剔除
    ExcludeTags     []string // 排除：命中任一标签即剔除
}
```

`SearchOptions` 同名两字段。RPC 请求体 `excludeProjects` / `excludeTags`。

## B2. 匹配函数

```go
// 与 projectPathMatchesAny 对称：空 = 不剔除。
func projectPathExcluded(projectPath string, excludes []string) bool {
    for _, p := range excludes {
        if p == ProjectFilterOther {
            if projectPathIsOther(projectPath) { return true }
            continue
        }
        if projectPathMatches(projectPath, p) { return true }
    }
    return false
}

// 与 sessionTagsContainAll 对称：归一化后任一命中即 true；tags 为空 → false。
func sessionTagsExcludeAny(tags []string, excludes []string) bool
```

`untagged` 交互：`sessionMatchesTagPresence` 现有「untagged + TagFilters 非空 → false」逻辑**不**因
`ExcludeTags` 触发；untagged 的会话本就没有标签，`sessionTagsExcludeAny` 自然返回 false。

## B3. 分布扣除（关键不变量）

`SQLiteIndex.ListWithDistribution`（`sqlite_index.go:1339`）：

```go
baseOpts := opts
baseOpts.Project = ""
baseOpts.Projects = nil            // 包含型不参与 dist
// 但 ExcludeTags / ExcludeProjects 仍保留在 baseOpts 里
for i := range summaries {
    if !summaryMatchesList(summaries[i], baseOpts) { continue }  // 已含排除
    dist[summaries[i].ProjectPath]++
    if !projectPathMatchesAny(summaries[i].ProjectPath, projects) { continue }
    ...
}
```

**不变量**：`sum(dist.values())` == 应用 source/date/marked/tags/排除 后、未应用「包含型多选」的会话数。
这是「排除后目录计数变小」的可测形式，必须单测断言。

`Index`（JSON 兜底）的 `List` / dist 聚合走同一顺序，防止双实现漂移。

## B4. 需要特别注意的漏传点

- `ListTags`（`sqlite_index.go:1302`）内部**重建** `ListOptions`，历史高发漏传点：必须带
  `Projects` / `ExcludeProjects` / `ExcludeTags`
- `Search`（`sqlite_index.go:1398`）内部重建 `ListOptions`，同上
- `Manager.scanListNow`（无缓存路径）走 `summaryMatchesList`，排除在函数内收口
- `Manager.cachedScanListWithDistribution`（`manager.go:371`）整结构体传递，天然带上，但要用测试锁住

## B5. 前端

- `pathExcludesAtom` 启用；`excludeTagsAtom` 新增
- 标签区、目录区各加 `包含 / 排除` 模式切换（`SegTrack`，本地 state `tagMode` / `pathMode`）
- 加入排除时与包含集合互斥：同 tag/同前缀从对方移除；`pathFilter`（浏览位置）若落在被排除前缀内，允许保留浏览但不影响过滤
- `ActiveChip` 增 `tone?: "exclude"`：`⊘` + 虚线边框 + 现有 error/destructive token 色
- `hasActive` / `activeFilterCount` / `filterSignature` / `onClearAll` 纳入两新 atom

## B6. 权衡

| 方案 | 结论 |
|---|---|
| 查询语法 `-#tag` / `!path:` | 否：要解析器 + 转义 + 中文/空格路径边界，且不可发现 |
| 在 `PathFilter` 内加 `exclude` 布尔 | 否：只能排一个，且污染浏览位置语义 |
| 独立 `excludeProjects []string` | **采纳** |
| 后端 SQL 否定条件 | 否：dist 必须回内存算，收益为零 |
| 三态 chip 点击 | 否：发现性差 |
| 段内 含/排 模式切换 | **采纳** |

---

# 兼容性、回滚与风险

**兼容**

- 新字段全部 `omitempty` + 空默认 → 混跑不变；`Project` 兼容字段保证旧调用方（`wshcmd-data.go:392` 等）不受影响
- `PathFilterOtherRoot` 取值变更只影响前端内部比较（全部走常量），但需检查 `hashStringToIndex` 颜色等副作用

**回滚**

- Phase A、Phase B 各自独立可 revert；后端无数据迁移，前端无持久化
- 唯一跨版本可见变化：升级后首次列表刷新会重置自动展开状态（一次）

**风险**

1. **双 Index 实现漂移** —— 两套测试 + review checklist
2. **dist 未扣除** —— 单测断言 `sum(dist)` 关系
3. **`Projects` 与 `Project` 同时存在时的优先级** —— 显式 `effectiveProjects`，单测锁定
4. **`__other__` 与真实路径冲突** —— `projectPath` 均为绝对路径，理论无冲突；匹配时先判哨兵再判前缀
5. **快速连续点选的响应乱序** —— 扩充 `isCurrentSessionsLoad` 的数组比较
6. **`generatets` 生成顺序** —— 必须先改 Go 结构体再 `node scripts/run-task.mjs generate`，否则 tsc 报错
7. **其它筛选器仍以 `pathFilter.root` 判定激活** —— 全文搜索一遍 `pathFilter` 引用，避免「浏览了就当成有筛选」的残留
