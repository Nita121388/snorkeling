# Implement: AI 会话筛选 — 路径多选 + 排除查询

> **Phase A 与 Phase B 各自独立可 revert。Phase B 开始前必须先完成 Phase A 的代码评审。**
> 顺序硬约束：**Go 结构体 → generate → 前端使用**，否则 tsc 报错阻碍调试。

## 前置检查

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go version"
node scripts/run-task.mjs --list | Select-String generate
```

工作区已有未提交改动（session-tree / controls / session-row 等），实现时**只碰本任务涉及文件**，
`git status` 逐个确认，不要连带提交无关改动。

---

# Phase A — 路径多选

## A1 后端：契约与匹配

`pkg/aisessions/types.go`

- [ ] 新增 `const ProjectFilterOther = "__other__"`（与前端哨兵取值一致，注释说明）
- [ ] `ListOptions` 增 `Projects []string`（放在 `Project` 之后，注释：非空时覆盖 `Project`）
- [ ] `SearchOptions` 增 `Projects []string`

`pkg/aisessions/index.go`

- [ ] 新增 `normalizeProjectFilters(in []string) []string`：TrimSpace → TrimRight(`/\`) → 去空 → 大小写不敏感保序去重；哨兵原样保留
- [ ] 新增 `projectPathIsOther(projectPath string) bool`：空串 / 相对路径 → true；绝对（`/`、`X:\`、`~/`）→ false
- [ ] 新增 `projectPathMatchesAny(projectPath string, projects []string) bool`：空集合 = true；哨兵与普通前缀任一命中即 true
- [ ] 新增 `effectiveProjects(opts ListOptions) []string`：`Projects` 非空优先，否则退回 `Project`，否则 nil
- [ ] `projectPathMatches` 本体**不改**（维持边界前缀语义），在注释中指向 `projectPathMatchesAny`

## A2 后端：三条 List 路径

`pkg/aisessions/index.go`（JSON 兜底）

- [ ] `Index.ListWithDistribution` / 分布聚合：`effectiveProjects` 替换 `opts.Project` 判定；dist 仍不含路径包含条件
- [ ] `Index.Search`：透传 `Projects`

`pkg/aisessions/sqlite_index.go`

- [ ] `ListWithDistribution`（~1339）：`baseOpts.Projects = nil`（dist 不含包含型多选），
      最终过滤用 `projectPathMatchesAny(summary.ProjectPath, effectiveProjects(opts))`
- [ ] `ListTags`（~1302）：内部重建的 `ListOptions` 带 `Projects`
- [ ] `Search`（~1398）：同上

`pkg/aisessions/manager.go`

- [ ] 确认 `scanListNow`（~218）与 `cachedScanListWithDistribution`（~371）整结构体传递，无需改；
      补测试锁住两条路径都应用 `Projects`

## A3 后端：RPC

`pkg/service/aisessionsservice/aisessionsservice.go`

- [ ] `AISessionsListRequest` 增 `Projects []string json:"projects,omitempty"`
- [ ] `AISessionsTagsRequest` 增 `Projects []string json:"projects,omitempty"`
- [ ] `List` / `Tags` 透传

## A4 后端测试

- [ ] `normalizeProjectFilters`：尾部分隔符 / 空白 / 大小写去重 / 哨兵保留
- [ ] `projectPathIsOther`：空串、相对路径、`/abs`、`E:\x`、`~/x`
- [ ] `projectPathMatchesAny`：空集合 = true；两个不相干目录并集；父+子幂等；哨兵；`snorkeling` vs `snorkeling-imgzoom`
- [ ] `effectiveProjects`：`Projects` 覆盖 `Project`
- [ ] `sqlite_index_test.go` + `index_test.go`：同一组用例各跑一遍（双实现一致）
- [ ] dist 断言：多选不影响 `ProjectPaths` 计数

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions ./pkg/service/aisessionsservice"
```

## A5 生成前端类型

```powershell
node scripts/run-task.mjs generate
git diff --stat frontend/types/gotypes.d.ts   # 必须出现 projects?: string[]
```

## A6 前端：状态拆分

`frontend/app/view/aisessions/types.ts`

- [ ] `PathFilterOtherRoot` 改为 `"__other__"`
- [ ] 新增 `DefaultPathSelections: string[] = []`
- [ ] 保留 `PathFilter` / `DefaultPathFilter` / `pathFilterToPrefix`（仅服务浏览）

`frontend/app/view/aisessions/aisessions.tsx`

- [ ] `pathSelectionsAtom = jotai.atom<string[]>(DefaultPathSelections)`（紧邻 `pathFilterAtom`）
- [ ] `loadSessions`（~302）：`projects = globalStore.get(this.pathSelectionsAtom)`；
      payload 用 `projects`，**移除** `project: projectPrefix`
- [ ] 删除 `otherRootMatcher` 本地后置过滤（~358）与其 import；`Other` 由后端哨兵处理
- [ ] `isCurrentSessionsLoad`（~453）：追加 `projects` 快照 + 大小写不敏感数组相等比较
- [ ] `remoteFilterActive` / `activeFilterCount` / `filterSignature`（~1236-1290）改用 `pathSelections`
- [ ] model 方法：`togglePathSelection(prefix)`、`setPathSelections(next)`、`clearPathSelections()`
- [ ] `onClearAll` 重置 `pathSelectionsAtom`
- [ ] 全文件排查残留的「以 `pathFilter.root` 判定筛选激活」之处（`session-overview.tsx` 若有引用一并核对）

`frontend/app/view/aisessions/filter-panel.tsx`

- [ ] 新 props：`pathSelections`、`togglePathSelection`、`setPathFilter`（已有）
- [ ] 根行：`All` = `setPathSelections([])`；每个根 chip toggle 选中（选中态 accent + 实心点）
- [ ] 面包屑：仅导航，不改选中集合
- [ ] 子目录 chips：名称区 toggle 选中；`›` 区域下钻（`stopPropagation`）；
      选中态 `fa-check`；被上级包含时淡化为选中态 + `title="已包含在上级选中目录中"`
- [ ] 激活 chip 条：每个 `pathSelections` 前缀一个 chip（复用 `shortenPathForChip`），可单删

## A7 前端测试

- [ ] `path-filter.test.ts`：哨兵取值、toggle 语义、父+子冗余、`pathFilterToPrefix` 仅用于浏览
- [ ] `aisessions` 请求组装：payload 含 `projects`、不含 `project`
- [ ] `filterSignature` 随 `pathSelections` 变化
- [ ] 浏览位置变化不影响选中集合（隔离性）

```bash
npx vitest run frontend/app/view/aisessions
npx eslint frontend/app/view/aisessions
```

## A8 手动验收（真实库）

1. 选 `E:\` + `~/` 两个根 → 列表 = 两者并集
2. 下钻到某子目录 → 列表不变（只看计数与更深子目录）
3. 父 + 子同时选 → 与仅父结果一致
4. 取消其中一个 → 只剩另一个
5. `Clear all filters` → 回到全量

---

# Phase B — 排除查询（Phase A 评审通过后开始）

## B1 后端

`pkg/aisessions/types.go`

- [ ] `ListOptions` / `SearchOptions` 增 `ExcludeProjects []string`、`ExcludeTags []string`

`pkg/aisessions/tags.go`

- [ ] `sessionTagsExcludeAny(tags, excludes []string) bool`：归一化、空排除 = false、空 tags = false、任一命中 = true

`pkg/aisessions/index.go`

- [ ] `projectPathExcluded(projectPath string, excludes []string) bool`：哨兵 + `projectPathMatches`
- [ ] `summaryMatchesList` 追加两条排除判定（放在包含判定之后）

`pkg/aisessions/sqlite_index.go`

- [ ] `ListWithDistribution`：`baseOpts` 保留排除字段、清空 `Projects`；循环内二次防御（与既有
      `sessionMatchesTagPresence` 二次判定风格一致）
- [ ] `ListTags`（~1302）与 `Search`（~1398）内部重建处补 `ExcludeTags` / `ExcludeProjects`

`pkg/service/aisessionsservice/aisessionsservice.go`

- [ ] `AISessionsListRequest` / `AISessionsTagsRequest` 增 `excludeTags` / `excludeProjects`，`List` / `Tags` 透传

## B2 后端测试

- [ ] `sessionTagsExcludeAny`：空排除 / 空 tags / 命中 / 大小写与 `#` / 多值 OR
- [ ] untagged + `ExcludeTags` 不被 `sessionMatchesTagPresence` 误判为空结果
- [ ] `projectPathExcluded`：父目录连带子目录；不误伤兄弟；哨兵
- [ ] dist 扣除断言：`sum(dist.values())` == 排除后、未应用包含型多选的会话数
- [ ] `sqlite_index_test.go` + `index_test.go` 双实现各跑一遍
- [ ] 缓存命中路径与全量扫描路径都应用排除

## B3 生成类型

```powershell
node scripts/run-task.mjs generate
git diff --stat frontend/types/gotypes.d.ts   # excludeTags?: string[]; excludeProjects?: string[]
```

## B4 前端

`aisessions.tsx`

- [ ] `pathExcludesAtom`、`excludeTagsAtom`（`string[]`）
- [ ] `loadSessions` payload 加 `excludeTags` / `excludeProjects`
- [ ] `Tags` 请求同样透传
- [ ] 互斥：加入排除 tag 时从 `tagFiltersAtom` 移除；反之亦然；
      加入排除目录时若与 `pathSelections` 中的前缀相同则从后者移除；反之亦然
- [ ] `remoteFilterActive` / `activeFilterCount` / `filterSignature` / `onClearAll` 纳入

`filter-panel.tsx`

- [ ] 标签区：`含 / 排` `SegTrack`（本地 state `tagMode`），chips 按模式分发；排除态样式：虚线 + `⊘` + 现有 error token
- [ ] 目录区：同样模式切换 + 面包屑行「⊘ 排除当前浏览目录」按钮（`pathFilterToPrefix(pathFilter) !== ""` 时可用）
- [ ] `ActiveChip` 增 `tone?: "exclude"`
- [ ] `tagPresence === "untagged"` 时标签段整体置灰（含模式切换）

## B5 前端测试

- [ ] 模式切换渲染、排除 chip 样式、untagged 置灰
- [ ] payload 含 `excludeTags` / `excludeProjects`
- [ ] 互斥：同 tag 先包含后排 → 只保留排除
- [ ] `filterSignature` 覆盖排除字段

```bash
npx vitest run frontend/app/view/aisessions
npx eslint frontend/app/view/aisessions
npx tsc --noEmit
```

## B6 手动验收（真实库）

1. 排除 `node_modules` → 列表减少，目录 chips 计数同步减少
2. 排除 `#debug` → 列表与搜索框结果同步剔除，`Tags` 计数减少
3. 包含 `#work` + 排除 `#debug` → 两者交叠
4. 同 tag 先包含后排 → chip 只显示排除态
5. `Clear all filters` → 回到全量
6. 等 ≥60s 自动刷新 → 条件保持、自动展开状态不被旧 signature 覆盖

---

# 检查门（收尾）

- [ ] `go test ./pkg/aisessions ./pkg/service/aisessionsservice`
- [ ] `npx vitest run frontend/app/view/aisessions`
- [ ] `npx eslint` 变更文件
- [ ] typecheck 通过
- [ ] `git status` 确认只改了本任务相关文件（工作区原有 12 个未提交改动不受影响）
- [ ] `frontend/types/gotypes.d.ts` 已被 generate 更新且无手改
- [ ] 是否需要新原型文件：复用现有 `aisessions-path-filter` 视觉，不新增
