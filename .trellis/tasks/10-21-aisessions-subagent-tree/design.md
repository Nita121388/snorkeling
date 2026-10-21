# 技术设计：子会话父子树

## 1. 数据流

```
~/.pi/agent/sessions/<project>/<父>.jsonl                 → kind=session
~/.pi/agent/sessions/<project>/<父>/forks/<x>.jsonl        → kind=fork
~/.pi/agent/sessions/<project>/<父>/<uuid>/**/*.jsonl      → kind=subagent

collectJSONLFiles → sessionFilesFromPaths → SessionFile{ParentPath, Kind}
  → ParseSummary → SessionSummary{ParentKey, Kind}
  → SQLite ai_sessions(+parent_key, +kind)   schema 3 → 4
  → List RPC → 前端构树
```

## 2. 后端

### 2.1 路径规则（`pkg/aisessions/provider_pi.go`）

pi 的会话根是 `~/.pi/agent/sessions`，其下第一层是 **project 目录**
（`--D--Code-LiCASmart--` 这种 slug）。因此对 `sessionsDir` 下的相对路径：

```
rel = <project>/<rest...>
len(rest) == 1  → 顶层 session
len(rest) > 1  → 属于 <project>/<rest[0]>/ 目录
                 parentPath = <project>/<rest[0]>.jsonl
                 kind       = 路径含 "forks" 段 ? fork : subagent
```

父会话 id = 父文件名去掉 `.jsonl` 后、最后一个 `_` 之后的段（pi 的 header id 与
文件名 UUID 一致，已实测确认），于是

```
parentKey = StableKey(source, parentID, parentPath)
```

`StableKey(source, id, filePath) = source + ":" + id + ":" + filePath`（`types.go:210`）。

**孤儿处理**：父文件不存在时（目录残留），`parentKey` 仍按规则计算，但列表层
发现父 key 不在结果集里 → 该行提升为顶层（见 2.4），不报错、不隐藏。

### 2.2 类型与索引

```go
// types.go
type SessionSummary struct {
    ...
    ParentKey string `json:"parentKey,omitempty"` // 空 = 顶层
    Kind      string `json:"kind,omitempty"`      // session | subagent | fork
}

// SessionFile 同样带 ParentPath / Kind，供 provider 透传
type SessionFile struct {
    ...
    ParentPath string
    Kind       string
}
```

SQLite `ai_sessions` 增两列（`parent_key TEXT`, `kind TEXT`），
`sqliteIndexSchemaVersion` 3 → 4。旧库缺列时：

- `CREATE TABLE IF NOT EXISTS` 不会改已有表 → 需要显式 `ALTER TABLE ... ADD COLUMN`
- 实现：`ensureColumn(ctx, table, column, ddl)` 用 `PRAGMA table_info` 判定后再 ALTER
- 回填：旧行 `kind` 为空 → 视为 `session`；`parent_key` 为空 → 顶层
  （下次扫描时 provider 会把真实值写回去，无需全量重建）

### 2.3 扫描期写入

`parseSummaryFile` 从 `SessionFile` 取 `ParentPath/Kind` 填进 `SessionSummary`；
`saveSummaryTx` 一并落库。`ScanSummaries` / `refreshChangedSummaries` 走同一条路径，
所以增量刷新也会更新父子关系。

### 2.4 列表层组装

`ListWithDistribution` 返回的行里，`ParentKey` 已由 DB 带回。前端构树：

```
childrenOf = Map<parentKey, SessionSummary[]>
roots      = rows.filter(r => r.parentKey == "" || !rows.some(x => x.key === r.parentKey))
```

"父不在结果集 → 提升为顶层"这条规则放在**前端**（筛选/搜索后结果集是子集，
后端无法预知哪些父会被滤掉）。后端只负责如实给出 `parentKey`。

### 2.5 `SubagentFold` 复用目录结构

`ExtractSubagentCalls` 目前按"同 cwd + name 前缀 + 时间窗"匹配候选文件。新规则：

1. 父会话的**子会话文件集合**可直接从磁盘结构得出（`collectJSONLFiles` 已能区分）
2. 派发调用 → 子会话的映射：优先用**创建时间落在调用时间窗内**的子会话
3. 仍多候选 → `ambiguous`（不猜测，UI 列候选）；无候选 → `missing`（降级普通工具行）

这比 agent 名匹配可靠：子会话没有 name 字段，但**时间窗 + 同目录**足够唯一
（实测一个父目录下 107 个子会话，创建时间分散在数天内，与单次派发时间窗基本一一对应）。

## 3. 前端

### 3.1 树渲染（`aisessions.tsx` / `session-group.tsx` / `session-row.tsx`）

```
rows → roots（顶层）+ childrenOf（Map）
→ <SessionTreeRow row depth={0}>
     ├ 父行：现有 SessionRow + 展开箭头 + 计数徽标
     └ 子行：SessionRow（variant="child"）缩进 20px + 竖线 + 图标
```

新增 `SessionRow` props：
- `depth?: number`（默认 0）→ 决定缩进与字号
- `childKind?: "subagent" | "fork"` → 决定图标
- `expandable?: boolean` / `expanded?: boolean` / `onToggleExpand?: () => void`
- `childCount?: number` → 父行计数徽标

子行图标：`fa-sparkles`（subagent）/ `fa-code-branch`（fork），
替代父行里的 source 圆点（source 在子行意义不大，但保留在 tooltip）。

### 3.2 展开状态

- `aisessions.expandedParents`（localStorage，逗号分隔的 key 集合）
- 已有 `readCollapsedGroups` / `writeCollapsedGroups` 可照抄套路
- 子会话 >20：展开时只渲染前 20 + "显示全部（还有 N 个）"按钮（组件内 state）

### 3.3 筛选 / 搜索

- `loadSessions` 拿到 rows 后：若某行 `parentKey` 对应的父在结果集里 → 挂到父下
- 父不在结果集 → 该行提升为顶层
- 搜索命中子会话 → 把父 key 加入展开集合（本次会话内 state 覆盖持久化值）
- 父行显示 `匹配子会话` 标记（accent 色计数徽标）

### 3.4 排序

顶层排序只用 `kind=session`（或无 parentKey）的行；子行跟随父行、按自己的
updatedAt 降序排在父行正下方。

## 4. 行内 note / 标签展示（R5）

现状（`session-row.tsx` 折叠条）：整行是一个 `<button className="text-xs text-primary">`，
内部 note 文字继承 `text-primary`，标签徽标是 `bg-accent/10 text-accent`，
超出 3 个时是**静态** `<span>+{N}</span>`。

改造：

1. **外层不再是 button**：`<button>` 不能嵌套 `<button>`。改成
   `<div role="button" tabIndex={0} onClick={toggleNoteEditor} onKeyDown={Enter/Space}>`，
   保留键盘可达性；行首 accent 竖条与 hover 态不变。
2. **note 文字** 加 `text-accent`，与标签徽标同色；外层 div 不再设 `text-primary`。
3. **`+N` 变真按钮**：
   ```tsx
   <button data-row-action="true"
           onClick={(e) => { e.stopPropagation(); setTagsExpanded((v) => !v); }}
           onKeyDown={Enter/Space}
           className="bg-accent/10 text-accent">
       {tagsExpanded ? "收起" : `+${overflow}`}
   </button>
   ```
   - `tagsExpanded` 为组件内 `useState`，不落盘、不记忆
   - 展开后标签 `flex-wrap` 换行，行高自适应；`+N` 换成"收起"
   - `data-row-action` 保证不触发行选中/双击打开
4. **默认 4 个**：`visibleSessionTags = sessionTags.slice(0, 4)`。
5. 单个标签徽标保持纯展示；点 note 文字仍是"进入编辑态"。

## 5. 兼容与回滚

- schema 3→4 向前兼容；旧索引直接打开，缺列自动 ALTER + 回填
- `parent_key` / `kind` 为空的老行按顶层 session 渲染（= 改动前行为）
- 前端开关：列表项属性缺失时按普通行渲染

回滚：纯 `git revert`（前端 + 后端 + 一次 schema 迁移；旧代码忽略新列即可）。

## 5. 测试

后端（`pkg/aisessions`）：
- `TestPiParentChildDetection`：3 种路径形态 → kind / parentKey 正确
- `TestPiOrphanChildDirectory`：父文件不存在 → parentKey 仍计算、不报错
- `TestSQLiteSchemaMigrationAddsParentColumns`：v3 库 → 打开后有列且旧行可读
- `TestSaveSummaryPersistsParentKey`

前端（`frontend/app/view/aisessions`）：
- `session-tree.test.ts`（纯逻辑）：`buildSessionTree` 造树、父缺失提升为顶层、子排序
- `session-row.test.tsx` 扩展：子行渲染缩进与图标、父行渲染计数徽标

回归：`go test ./pkg/aisessions/...` + `vitest frontend/app/view/aisessions` 全绿。
