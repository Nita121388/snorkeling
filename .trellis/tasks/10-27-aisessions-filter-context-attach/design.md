# Design：筛选结果双向补带

> 完整论证与方案对比见 `design/plans/aisessions-filter-hierarchy-fill.md`。本文只固化落地契约。

## 1. 数据契约

`pkg/aisessions/types.go`

```go
// SessionSummary
// Attached 为空 = 自身命中筛选；"parent" = 补带的父；"child" = 带出的子。
// 请求期派生字段，不落库。
Attached string `json:"attached,omitempty"`

// ListOptions / SearchOptions
AttachMode    string // "" / "off" / "both" / "parent" / "children"
AttachMaxRows int    // 0 = 500
```

`ScanListResult` 增加 `AttachTruncated bool`；service 的 `AISessionsListRequest` /
`AISessionsSearchRequest` 透传 `attachMode`、`attachMaxRows`，`AISessionsListResponse` /
`AISessionsSearchResponse` 透传 `attachTruncated`。

## 2. 后端实现

新文件 `pkg/aisessions/context_attach.go`：

```go
func normalizeAttachMode(mode string) string
func attachContext(ctx context.Context, rows, allRows []SessionSummary, opts ListOptions,
                   applyMeta func(*SessionSummary) error) []SessionSummary
```

步骤：present 索引 → 上行（直接父，`Attached="parent"`）→ 下行（直接子 `kind=subagent|fork`，
每个命中父最多 50 条，`Attached="child"`）→ 全局 `AttachMaxRows` 截断 → 追加到结果尾部。
硬排除校验 `projectPathExcluded` + `sessionTagsExcludeAny`；`Missing` 跳过；`present` 去重。

调用点：

| 位置 | 全量行来源 | meta |
|---|---|---|
| `sqlite_index.ListWithDistributionAndQuery`（新增，`ListWithDistribution` 委托给它） | 已加载的全表 | 已批量应用 |
| `manager.scanListNow` | 过滤前 `summaries` | 回调 `metaIdx.ApplyMeta` |
| `sqlite_index.Search` | `idx.List(limit 0)` 的产物 | 已应用 |
| `manager.cachedScanListWithDistribution` | 改调 `ListWithDistributionAndQuery`，删除自己那份 query 过滤循环 | — |

`limit` 只在 attach 之前作用于命中集。排序不做整体重排（前端 `buildSessionTree` 自己排）。

## 3. 前端实现

| 文件 | 改动 |
|---|---|
| `frontend/types/gotypes.d.ts` | `task generate` 生成 `attached`、`attachMode`、`attachMaxRows`、`attachTruncated` |
| `types.ts` | `AttachMode` 类型 + 默认值 + localStorage 读写键 |
| `aisessions.tsx` | 新 atom `attachModeAtom`；`loadSessions` 传 `attachMode`；`matchedKeys` 用 `!attached` 推导；`matchedChildParentKeys` 换成 `collectParentsOfMatches`；`selectAll` 过滤 attached；复制文案带上下文计数 |
| `utils.ts` | `groupSessionsByProject` 接收并透传 `matchedKeys` |
| `session-group.tsx` | 时间模式 `buildSessionTree` 传 `matchedKeys` |
| `session-tree.ts` | 无需改（参数早已就绪）；`matched`/`matchedChildCount` 自动生效 |
| `session-row.tsx` | 新增 `attached` prop：次要色 + 图标 + tooltip |
| `filter-panel.tsx` | 「包含上下文」三段式开关（精确 / 智能 / 只带子代理），注册进 activeFilterCount 之外的独立分区 |

## 4.5 按 session id 筛选

`summaryMatchesQuery`（`pkg/aisessions/index.go`）是三条筛选路径共用的自由文本匹配：

- 可搜字段加入 `SessionSummary.Key`（`source:id:filePath`），因此整条 key 也能命中；
- `session:` / `sessionid:` / `id:` / `key:` 前缀会被剥掉后再比一次 id/key（大小写不敏感）；
- 前端不另做解析：把用户输入原样作为 `query` 发出即可；
- 行 tooltip 增加 `Session ID:`，搜索框 placeholder 补上 session ID，降低发现成本。

## 4. 测试

- `pkg/aisessions/context_attach_test.go`：模式矩阵、limit、父子去重、硬排除、截断、孤儿、缺失行。
- `frontend/app/view/aisessions/utils.test.ts`：`groupSessionsByProject` 透传 `matchedKeys`。
- `session-tree.test.ts`：新增 attached 行参与成树 + `matchedChildCount` 不含 attached。

## 5. 回滚

后端默认 `attachMode=off`，前端把 localStorage 值删掉/切「精确」即完全回到旧行为；无 schema 变更，无数据迁移。
