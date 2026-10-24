# PRD: AI 会话筛选 — 路径多选 + 排除查询（标签 / 目录）

## 背景

AISessions 列表（`frontend/app/view/aisessions/` + `pkg/aisessions/`）当前筛选能力有两个结构性缺口：

1. **路径筛选只能单选**：`PathFilter { root, subPath }` → 单个 `project` 前缀。想看「`E:\code\snorkeling` 加上 `E:\primary\obsidian` 两个目录的会话」做不到，只能一次次切换。
2. **全部是「包含型」条件**：标签只有 `tagFilters`（全含 AND）+ `tagPresence`；路径只有单个 `project`。无法表达「不看 `#debug`」「不看 `node_modules` / `legacy` 目录」，只能靠穷举包含条件，实际做不到。

用户明确要求：**先做路径多选，再做排除**。路径多选是排除的前置结构（两者共用同一套「前缀集合 + OR 匹配」语义）。

## 目标

### Phase A — 路径多选（前置）

1. 路径筛选支持**多选**：用户可同时选中多个目录前缀（含根级别如 `E:\`、`/`、`~/`），结果取并集。
2. 单独维护「当前浏览位置」与「已选目录集合」：浏览目录（下钻看子目录/计数）不再隐式改筛选条件。
3. 多选语义为**前缀 OR**：选中 `.../snorkeling` 覆盖其所有子目录；不误伤同名前缀兄弟（`snorkeling-imgzoom`）。
4. **Other 桶服务端化**：`PathFilterOtherRoot`（空/无法识别的 `projectPath`）从「前端拿全量结果再本地过滤」改为后端可表达的哨兵值，从而能与其它选中路径并集、也能被排除。

### Phase B — 排除查询

5. 标签与目录都支持**排除**：`excludeTags`（命中任一即剔除）+ `excludeProjects`（命中任一前缀即剔除）。
6. 排除与包含 AND 组合，排除优先：`结果 = 包含交集 − 排除并集`。
7. 目录分布计数（`projectPaths`）**先应用排除再累加**，避免「排除了但计数不变」。
8. `List` 与 `Search`（含缓存命中、全量扫描两条路径）行为一致。

### 通用

9. UI 可发现、可撤销：路径 chips 显示选中态；已生效条件以 chip 展示，可单个移除、可一键清空。

## 非目标

- 不做查询语法（`-#debug`、`!path:`）——先做结构化 UI，不做解析器。
- 不做 source / marked / 日期区间的多选或排除（单值维度，收益低、UI 拥挤）。
- 不改数据库 schema、不新增 SQL：过滤全部在已载入的 summary 内存列表上完成。
- 不改变标签计数（`ListTags`）之外的聚合口径。
- 不把筛选条件持久化到 localStorage（维持现有 widget 内 jotai atom 语义）。

## 决策（按评审推荐采纳，如有异议在实现前改）

| # | 决策 | 取舍 |
|---|---|---|
| 1 | Phase A 先落地，Phase B 复用同一套前缀集合结构 | 避免为单选写一套再推倒 |
| 2 | 「浏览位置」与「选中集合」拆成两个 state | 否则下钻即改条件，多选无法操作 |
| 3 | 多选 = OR 并集；父目录覆盖子目录，允许冗余选择（不静默删除） | 静默删除会导致「再点子目录没反应」的困惑 |
| 4 | Other 桶改为后端哨兵 `__other__` | 前端本地过滤与多选并集/排除天然冲突 |
| 5 | 子目录 chip 单击 = 选中/取消；`›` 箭头 = 下钻 | 文件树惯例，两种意图都要保留 |
| 6 | 同一标签/目录不能同时「含」又「排」，后加者胜出 | 与现有 `tagFilters ↔ tagPresence` 原子互斥风格一致 |
| 7 | `tagPresence = untagged` 时标签区（含排除模式）整体置灰 | 未打标签的会话排除标签无意义 |
| 8 | `Project string` 保留为兼容字段；`Projects` 非空时优先 | 现存 RPC/测试调用零破坏 |

## 用户故事

1. 作为用户，我一次选中 `E:\code` 和 `~/obsidian` 两个目录，列表显示两者并集。
2. 作为用户，我下钻到某个子目录只为看它的计数与更深的子目录，不希望筛选条件被改掉。
3. 作为用户，我选中一个目录后再点一次即取消选中；选中态在 chip 与目录行都能看到。
4. 作为用户，排除 `node_modules` 后列表和目录 chips 计数一起变小。
5. 作为用户，排除 `#debug` 后，全文搜索结果里也不再出现带该标签的会话。
6. 作为用户，我把同一标签先设为包含再设为排除，不会得到看不懂的空结果。
7. 作为用户，点「Clear all filters」能同时清空包含（含多选路径）与排除条件。

## 验收标准

### Phase A

- [ ] `List` 请求支持 `projects: string[]`（OR 前缀并集），保留 `project` 单值兼容；两者同时出现时 `projects` 生效
- [ ] 前端请求发送 `projects`（由选中集合构造），不再由「浏览位置」直接决定过滤
- [ ] 「浏览位置」下钻不改过滤结果；选中/取消选中目录立即刷新列表
- [ ] `__other__` 哨兵在后端可匹配「空 / 无法识别 `projectPath`」，可参与并集与排除
- [ ] 删除 `aisessions.tsx` 中 `pathFilter.root === PathFilterOtherRoot` 的本地 `otherRootMatcher` 后置过滤（改由后端处理）
- [ ] 目录 chips 显示选中态；选中集合与浏览位置互不干扰
- [ ] 前缀边界语义保持：`.../snorkeling` 不匹配 `.../snorkeling-imgzoom`
- [ ] 冗余选择（父+子同时选中）结果与非冗余一致（幂等）
- [ ] Go 单测：多前缀 OR、哨兵、边界、父+子幂等、dist 不受「包含选择」影响
- [ ] 前端单测：选中切换、浏览位置独立性、请求组装
- [ ] 真实库手动验证：选两个根 → 列表为并集；下钻不改结果

### Phase B

- [ ] `List` / `Search` 支持 `excludeTags`、`excludeProjects`（OR 剔除）
- [ ] `ListWithDistribution` 的 `ProjectPaths` 已扣除排除项（`sum(counts)` 与被排除后的会话数一致）
- [ ] `ListTags` / `Tags` RPC 透传排除字段，标签计数与视图一致
- [ ] JSON `Index` 兜底路径与 `SQLiteIndex` 主路径行为一致（两套测试）
- [ ] FilterPanel 标签区、目录区各有 `包含 / 排除` 模式切换；排除 chip 视觉可区分
- [ ] 包含/排除冲突后加者胜出；`Clear all` 全清
- [ ] `remoteFilterActive` / `activeFilterCount` / `filterSignature` 纳入多选与排除字段
- [ ] Go + 前端单测；lint / typecheck 通过
- [ ] 真实库手动验证：排除目录后计数一致；排除标签后搜索结果同步剔除

## 里程碑

- M1 后端：`Projects []string` + 哨兵 + 多前缀 OR 匹配（Go 单测）
- M2 前端：state 拆分（browse / selected）+ 请求组装 + UI 选中态（单测）
- M3 后端：排除字段 + dist 扣除 + RPC 透传（Go 单测）
- M4 UI：含/排模式切换 + 排除 chips + 签名/清空（前端单测）
- M5 验收：真实库手动验证 + lint / typecheck / test

> M3 开始前必须完成 M1/M2 的代码评审，避免两套改动在同一 diff 里互相掩盖。
