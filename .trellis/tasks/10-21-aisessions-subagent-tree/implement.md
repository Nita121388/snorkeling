# 执行计划：子会话父子树 + 行内 note/标签展示

## 阶段 A — 后端父子识别（P0）

### A1 路径规则纯逻辑（可单测）

- [ ] 新文件 `pkg/aisessions/parent_child.go`
  - [ ] `classifyPiSessionFile(sessionsDir, filePath string) (parentPath string, kind string)`
  - [ ] `parentKeyForPiFile(source, sessionsDir, filePath string) string`（父不存在也照算）
  - [ ] `parentUUIDFromDirName(dirName string) string`（取最后一个 `_` 之后的段）
- [ ] 测试 `parent_child_test.go`：
  - [ ] 顶层 `<project>/<x>.jsonl` → kind=session, parentPath=""
  - [ ] `<project>/<x>/forks/<y>.jsonl` → kind=fork
  - [ ] `<project>/<x>/<uuid>/run-0/session.jsonl` → kind=subagent
  - [ ] `<project>/<x>/<uuid>/<file>.jsonl` → kind=subagent
  - [ ] 多层嵌套（6 层）→ 仍归到 `<project>/<x>.jsonl` 这一个父
  - [ ] 文件名无 `_` 分隔的边界情况不 panic

验证：`powershell -File _gt.ps1` → `go test ./pkg/aisessions/ -run 'ParentChild|PiParent'`

### A2 类型与索引

- [ ] `SessionFile` 增 `ParentPath string` / `Kind string`（`types.go`）
- [ ] `SessionSummary` 增 `ParentKey string` / `Kind string`（`types.go`）
- [ ] `sqlite_index.go`：`ai_sessions` 增 `parent_key` / `kind`；`sqliteIndexSchemaVersion` 3 → 4
- [ ] `ensureColumn(ctx, table, column, ddl)`：`PRAGMA table_info` 判定后 `ALTER TABLE ADD COLUMN`
- [ ] `saveSummaryTx` 落库两列；行→summary 映射带上两列
- [ ] 测试 `TestSQLiteSchemaMigrationAddsParentColumns`（v3 库打开后有列、旧行可读、kind 空按 session）

### A3 provider 接线

- [ ] `provider_pi.go`：`ListFiles` 对每个文件填 `ParentPath` / `Kind`；`ParseSummary` → `SessionSummary.ParentKey/Kind`
- [ ] 测试：fixture 目录结构 → 断言 kind / parentKey

**Gate A**：`go vet ./pkg/aisessions/... && go test ./pkg/aisessions/...`

## 阶段 B — 列表树渲染（P0）

### B1 纯逻辑

- [ ] 新文件 `frontend/app/view/aisessions/session-tree.ts`
  - [ ] `buildSessionTree(rows: SessionSummary[]): SessionTreeNode[]`（父缺失的子行提升为顶层）
  - [ ] `collectDescendants` / `countDescendants`
- [ ] 测试 `session-tree.test.ts`：造树、父缺失提升、计数、空输入、自引用防御

### B2 渲染

- [ ] `SessionRow` 增 props：`depth`、`childKind`、`childCount`、`expandable`、`expanded`、`onToggleExpand`
  - [ ] 子行：缩进 20px + 竖线 + `fa-sparkles`/`fa-code-branch` 图标 + 更小字号
  - [ ] 父行：展开箭头 + `+N` 计数徽标（仅 expandable 时）
- [ ] `session-group.tsx`：递归渲染 children（`depth+1`）
- [ ] `aisessions.tsx`：`buildSessionTree` 结果交给列表；展开集合 `expandedParentsAtom`（localStorage 持久化，照 `readCollapsedGroups` 套路）
- [ ] 子会话 >20：默认 20 个 + "显示全部（还有 N 个）"按钮

### B3 交互

- [ ] 点箭头 / 计数徽标 → 只展开/收起（不选中、不打开）
- [ ] 单击行 = 选中；双击 = 打开 Detail Block；Ctrl/Cmd+点击 = 强制新开（已提交，回归确认）
- [ ] 行内控件不影响选中与展开（已提交，回归确认）

**Gate B**：`vitest run frontend/app/view/aisessions` 全绿

## 阶段 C — 筛选与搜索（P1）

- [ ] 筛选/搜索后：父不在结果集 → 子行提升为顶层
- [ ] 搜索命中子会话 → 自动展开父 + 该子行可见
- [ ] 父行显示"匹配子会话"标记 + accent 计数徽标
- [ ] 顶层排序只用顶层行；子行跟随父行

**Gate C**：`vitest` + 手测三种筛选组合

## 阶段 D — 行内 note/标签展示（P1）

- [ ] 外层 note toggle 从 `<button>` 改成 `<div role="button" tabIndex={0}>`（支持 Enter/Space）
- [ ] note 文字加 `text-accent`（与标签徽标同色）
- [ ] `+N` 变真 `<button data-row-action>`：展开全部标签（`flex-wrap`）+ 展开后显示"收起"
- [ ] 默认显示 4 个标签：`visibleSessionTags = sessionTags.slice(0, 4)`
- [ ] 测试：`session-row.test.tsx` 扩展（note 与标签同色、+N 可展开/收起、点 +N 不进编辑态）

**Gate D**：`vitest run frontend/app/view/aisessions` 全绿

## 阶段 E — 详情内子代理卡片匹配改进（P1）

- [ ] `SubagentFold` 优先用目录结构（`parentKey` 已知 → 同目录候选），agent 名 + 时间窗兜底
- [ ] 测试：用 fixture 覆盖"有目录候选但无 name"的场景

**Gate E**：`go test ./pkg/aisessions/...`

## 阶段 F — 收尾

- [ ] 全量 `tsc --noEmit` 由 async 子代理跑，确认本任务 0 新增错误
- [ ] `git status` 只提交本任务文件（`utils.ts` 的 CRLF 差异不提交）
- [ ] commit + 更新任务 meta

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 旧 1.7GB 索引打开变慢 | 缺列只 ALTER 一次；不触发全量重建 |
| 107 个子会话一次展开撑爆列表 | 默认 20 个 + "显示全部" |
| 父子关系判错（同名目录非本会话派生） | 规则保守：只有"与父会话同名"的目录才算子会话 |
| 外层 div+role=button 的 a11y 退化 | 补 tabIndex + onKeyDown + aria-label |
| 两处改动都动 session-row.tsx | 同一任务一次实现一次提交，避免交叉 |

## 会话纪律（沿用）

1. 慢校验（全量 tsc / 全量 vitest）→ async 子代理，禁止主会话同步跑。
2. Go 工具链走子 PowerShell：`powershell -File` + `cmd /c "go ... > file 2>&1"`。
3. 不碰用户数据：`~/.pi`、`~/.codex`、`~/.snorkeling/ai-sessions` 只读。
