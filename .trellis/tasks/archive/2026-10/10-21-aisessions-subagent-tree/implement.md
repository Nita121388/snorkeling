# 执行计划：子会话父子树 + 行内 note/标签展示

## 阶段 A — 后端父子识别（P0）

### A1 路径规则纯逻辑（可单测）

- [x] 新文件 `pkg/aisessions/parent_child.go`（导出 `ClassifyPiSessionFile` / `PiParentKey` / `piUUIDFromDirName`）
- [x] 测试 `parent_child_test.go`（含路径逃逸根目录、父文件不存在、自引用边界）
- [x] **测试抓到的 2 个真实 bug 已修**：路径逃逸 sessions 根被误判为 subagent；`PiParentKey` 取父目录名而非父文件名导致 UUID 恒空

验证：`powershell -File _gt.ps1` → `go test ./pkg/aisessions/ -run 'ParentChild|PiParent'`

### A2 类型与索引

- [x] `SessionFile` 增 `ParentPath` / `Kind`（`types.go`）
- [x] `SessionSummary` 增 `ParentKey` / `Kind`（`types.go`）
- [x] `sqlite_index.go`：`ai_sessions` 增 `parent_key` / `kind`；`sqliteIndexSchemaVersion` 3 → 4
- [x] 抽出 `ensureAISessionColumns`（`PRAGMA table_info` 判定后 `ALTER TABLE ADD COLUMN`），provenance 与 parent 两组列共用
- [x] `saveSummaryTx` 落库两列；`sqliteSessionRow` / `summary()` / `sessionSummaryColumns` 带上两列
- [x] 测试 `sqlite_parent_columns_test.go`：v3 库打开后有列、旧行可读、`SaveSummary` 往返、`List` 投影

### A3 provider 接线

- [x] `provider_pi.go`：`ListFiles` 对每个文件填 `ParentPath` / `Kind`；`ParseSummary` 兜底分类并写 `ParentKey` / `Kind`
- [x] 测试 `provider_pi_parent_test.go`：真实三层目录（顶层 / forks / uuid-run-0）→ 断言 kind / parentKey 且子 parentKey == 父 key

**Gate A**：`go vet ./pkg/aisessions/... && go test ./pkg/aisessions/...`

## 阶段 B — 列表树渲染（P0）

### B1 纯逻辑

- [x] 新文件 `frontend/app/view/aisessions/session-tree.ts`
  - [x] `buildSessionTree`（父缺失/自引用/空 parentKey → 顶层；两级 + 时间倒序）
  - [x] `visibleChildren` / `hasHiddenChildren` / `hiddenChildCount`（20 个上限）
  - [x] `collectParentsOfMatches` / `collectParentKeysToExpand` / `countTreeRows`
- [x] 测试 `session-tree.test.ts`（**17 用例**）：造树、父缺失提升、自引用防环、排序 tie-break、匹配计数、20 上限与「显示全部」

### B2 渲染

- [x] `SessionRow` 增 props：`depth`、`childKind`、`childCount`、`matchedChildCount`、`expandable`、`expanded`、`onToggleExpand`
  - [x] 子行：竖线 + `fa-wand-magic-sparkles`(subagent)/`fa-code-branch`(fork) + 更小字号
  - [x] 父行：展开箭头 + `+N` 计数徽标（命中筛选时显示 `匹配数/总数` 并走 accent）
- [x] `session-group.tsx`：`renderNode` 递归渲染（`ProjectSessionGroup.tree`）
- [x] `utils.ts`：`groupSessionsByProject` 为每个分组构建 `tree`（`ProjectSessionGroup.tree` 新字段）
- [x] `aisessions.tsx`：`expandedParents` + `fullyExpandedParents` 状态；`readExpandedParents`/`writeExpandedParents` 持久化
- [x] 子会话 >20：默认 20 个 + 「Show all」按钮

### B3 交互

- [x] 点箭头 / 计数徽标 → 只展开/收起（`data-row-action` + `stopPropagation`）
- [x] 单击行 = 选中；双击 = 打开 Detail Block；Ctrl/Cmd+点击 = 强制新开（回归确认，见上一提交）
- [x] 行内控件不影响选中与展开（回归确认）

**Gate B**：`vitest run frontend/app/view/aisessions` 全绿

## 阶段 C — 筛选与搜索（P1）

- [x] 筛选/搜索后：父不在结果集 → 子行提升为顶层（`buildSessionTree` 内建）
- [x] 搜索命中子会话 → 自动展开父（`matchedChildParentKeys` + effect，只加不减，不覆盖用户选择）
- [x] 父行显示"匹配子会话"计数（`matchedChildCount/total` accent 徽标）
- [x] 顶层排序只用顶层行；子行跟随父行（子行按自身 updatedAt 倒序）

**Gate C**：`vitest` + 手测三种筛选组合

## 阶段 D — 行内 note/标签展示（P1）

- [x] 外层 note toggle 从 `<button>` 改成 `<div role="button" tabIndex={0}>`（支持 Enter/Space）
- [x] note 文字加 `text-accent`（与标签徽标同色）
- [x] `+N` 变真 `<button data-row-action>`：展开全部标签（`flex-wrap`）+ 展开后显示"收起"
- [x] 默认显示 4 个标签：`visibleTagsFor` / `hiddenTagCount` 纯函数
- [x] 测试：`session-row.test.tsx` 扩展 11 用例（div[role=button] 可嵌套按钮、+N 计数、note/tag 同色、无 note 不渲染）

**Gate D**：`vitest run frontend/app/view/aisessions` 全绿

## 阶段 E — 详情内子代理卡片匹配改进（P1）

- [x] `SubagentFold` 优先用目录结构（`subagentCandidateEligible`：结构候选只校验时间窗，fork 永不匹配，名称+时间窗兜底）
- [x] 测试：`subagent_fold_test.go` 补 5 用例（无 name 的结构候选、fork 排除、时间窗外、混合 ambiguous、候选不复用）

**Gate E**：`go test ./pkg/aisessions/...`

## 阶段 F — 收尾

- [x] 全量 `tsc --noEmit`：本任务文件 0 错误
- [x] `git status` 只提交本任务文件（工作区他人改动不 stage）
- [x] commit + 更新任务 meta

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
