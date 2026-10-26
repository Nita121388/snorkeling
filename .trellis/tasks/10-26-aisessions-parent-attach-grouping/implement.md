# 执行计划：AI 会话父级回填与分组归位

> 状态：planning（未开始实施）。`task.py start` 后才进入 Phase 2。

## 前置

```powershell
# 工具链（Windows）
npm run setup
. .\scripts\use-local-env.ps1 -Quiet

# 现状基线
git status --short
powershell -NoProfile -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions"
npm test -- --run aisessions
```

**重要**：开工前工作区已有 13 个未提交改动（annotation 相关）。本任务的所有改动必须
与它们**分开 commit**，不要混进去。建议先确认 annotation 那批是否要先提交，或在
`implement.jsonl` 里标注。

## M1 后端回填（P0）

- [ ] 1.1 `pkg/aisessions/types.go`：`SessionSummary` 加 `Attached` / `ParentMissing`
      两个字段（`json:"attached,omitempty"` / `json:"parentMissing,omitempty"`）。
      确认 `PascalToCamel` 生成器会写到 `frontend/types/gotypes.d.ts`（有生成脚本就
      跑一次，没有就手改）。
- [ ] 1.2 `pkg/aisessions/sqlite_index.go`：新增 `GetByKeys(ctx, keys []string) (map[string]SessionSummary, error)`，
      复用现有 `scanSummaryFromRow` 的列映射，`WHERE key IN (?,...)` 分批 ≤ 500 个 key。
- [ ] 1.3 新文件 `pkg/aisessions/parent_attach.go`：
      - `effectiveProjectPath(s, byKey)`（纯函数，导出给测试）
      - `(m *Manager) attachParentContext(ctx, rows, opts)` 按 design §3.2 实现
      - 常量 `attachMaxDepth/attachMaxFileLookup/attachMaxRows`
      - 顶部注释写清：**只追加不重排**，父行位置由前端 `buildSessionTree` 决定
- [ ] 1.4 `manager.go`：`ScanListResult` 与 `Search` 的 sqlite 早返回分支接上
      `attachParentContext`；`enqueueAutoTitles` 移到 attach 之后。
- [ ] 1.5 `pkg/aisessions/parent_attach_test.go`：design §6 的 8 个用例。
- [ ] 1.6 验证：`go test ./pkg/aisessions -run 'Attach|EffectiveProject|Parent' -v`

**审查门 G1**：单测全绿 + 手工 `curl`/UI 触发一次 List，确认无 panic、耗时无明显变化。

## M2 路径过滤口径（P0）

- [ ] 2.1 `scanListNow`：过滤前建全量 `byKey`，过滤改判 `effectiveProjectPath`；
      `dist` 口径同步。
- [ ] 2.2 `cachedScanListWithDistribution`：保持 SQL 侧自身 path 过滤，之后走
      `attachParentContext`（B1 方案）。
- [ ] 2.3 补测：`TestScanListCrossDirChildIncluded`、`TestDistUsesEffectivePath`。
- [ ] 2.4 回归：`go test ./pkg/aisessions`（全量）。

**审查门 G2**：`Projects=[P:\a]` 时异目录子会话必须出现在结果里；`ExcludeProjects`
行为不变。

## M3 前端分组与构树（P0）

- [ ] 3.1 `utils.ts`：加 `normalizeGroupPathKey`、`resolveGroupAnchor`；
      重写 `groupSessionsByProject`（桶 key = 规范化锚点路径，组名 = basename）。
- [ ] 3.2 `ProjectSessionGroup` 加 `hitCount` / `attachedCount`；`basenamePath` 保留导出。
- [ ] 3.3 `session-tree.ts`：加 `countAttachedRows(nodes)`（纯函数）。
- [ ] 3.4 `aisessions.tsx`：构造 `matchedKeys` 时排除 `attached`；「全选」过滤
      `!s.attached`。
- [ ] 3.5 `utils.test.ts` / `session-tree.test.ts`：design §6 前端用例。
- [ ] 3.6 验证：`npx vitest run frontend/app/view/aisessions/utils.test.ts frontend/app/view/aisessions/session-tree.test.ts`

**审查门 G3**：同名不同路径分组独立（AC3）、异目录子会话归父组（AC1）。

## M4 PathChip（P0）

- [ ] 4.1 新文件 `frontend/app/view/aisessions/path-chip.tsx`（design §4.3），
      tooltip 双行、点击复制、`useCopyStatus` 复用、剪贴板缺失降级。
- [ ] 4.2 `session-group.tsx`：组头 `<button>` → `<div role="button" tabIndex={0}>`
      （含 Enter/Space 键盘处理）；插入 PathChip（`showIcon={false}`）；
      组头徽标改用 `hitCount`，tooltip 追加 `+N 上下文行`；
      `groupCollapsedStorageKey` → `aisessions.groupCollapsed.v2`。
- [ ] 4.3 `session-row.tsx`：新增 `attached` / `parentMissing` / `groupPath` props；
      子行 PathChip（仅当 basename 不同）；`attached` 灰显 + `fa-link`；
      `parentMissing` 断链图标；行 tooltip 双行路径。
- [ ] 4.4 `session-group.tsx` 的 `renderNode` 透传 `groupPath={group.path}`。
- [ ] 4.5 `session-detail.tsx`：头栏标题右侧插 PathChip，子会话带父目录。
- [ ] 4.6 新测试 `path-chip.test.tsx`；补 `session-row.test.tsx` / `session-group` 用例。
- [ ] 4.7 验证：`npx vitest run frontend/app/view/aisessions` + `npx tsc --noEmit`

**审查门 G4**：AC4 / AC5 / AC9 手测通过；组头键盘可达（Tab + Enter 折叠）。

## M5 收尾（P1）

- [ ] 5.1 真孤儿行视觉（AC7）+ 断链 tooltip。
- [ ] 5.2 CDP 实测（应用以 `--remote-debugging-port=9222` 启动）：
      ```
      node scripts/inspect-electron-ui.mjs state
      node scripts/inspect-electron-ui.mjs elements --limit 40
      node scripts/inspect-electron-ui.mjs screenshot
      ```
      核对：回填行透明度、chip 溢出、组头高度、tooltip 内容。
- [ ] 5.3 性能核对（AC12）：1000+ 会话下记录 List RPC 耗时前后对比
      （日志里 `debugf("Manager.loadMessages ...")` 同款方式临时加点，或看
      `listBudgetDuration` 是否被触发）。
- [ ] 5.4 全量回归：`go test ./...`（或至少 `./pkg/aisessions ./pkg/service/aisessionsservice`）
      + `npm test -- --run`

**审查门 G5**：AC1~AC12 全部勾选；无新增 test failure。

## 提交策略

分层提交，便于单独回滚：

1. `feat(aisessions): 父级回填 attach（后端）` ← M1+M2
2. `feat(aisessions): 分组锚点与同名目录分离` ← M3
3. `feat(aisessions): PathChip 目录名/复制` ← M4
4. `polish(aisessions): 回填行与孤儿行视觉` ← M5

每步 `git diff --stat` 检查是否误带 annotation 改动。

## 回滚点

| 回滚到 | 操作 |
|---|---|
| 只回滚视觉 | revert 第 3/4 个 commit，后端保留 |
| 只回滚分组 | revert 第 2/3 个 commit，后端 attach 保留（前端会当普通行显示，可接受） |
| 全部回滚 | revert 全部 4 个 commit；无 DB migration 需求 |

## 风险与应对

| 风险 | 触发信号 | 应对 |
|---|---|---|
| 回填导致列表行数异常膨胀 | 组内出现大量灰行 | 检查 `attachMaxRows`；若父被 query 大量命中说明 `matchedKeys` 构造有误 |
| 慢盘上 List 变慢 | 日志出现 `listBudgetDuration` 超时 | 关闭第 3 级文件回填（`attachMaxFileLookup = 0`）应急 |
| 组头 DOM 改动影响折叠 | 点组名不折叠 | 检查 `role=button` 的 `onKeyDown` 与 PathChip 的 `stopPropagation` |
| 折叠状态全丢 | 用户反馈「展开态没了」 | 预期行为（R6.1），一次性的 |
| `gotypes.d.ts` 未更新 | TS 报 `attached` 不存在 | 跑生成脚本或手改，并确认 commit 里带上 |
