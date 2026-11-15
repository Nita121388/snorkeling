# 执行计划：VCS History 泳道提交图

## 顺序清单

### 阶段 1 · 数据层（Go）

- [x] 1.1 `pkg/wshrpc/wshrpctypes.go`：`VcsCommitInfo` 加 `AuthorEmail/Parents/Refs`；`VcsCommitFileInfo` 加 `Added/Deleted`
- [x] 1.2 `pkg/wshrpc/wshremote/vcs.go`：
  - `loadGitCommitsWithOffset` 格式扩为 `%H%x1f%an%x1f%ad%x1f%s%x1f%ae%x1f%P%x1f%D%x1e`
  - `loadGitRemoteCommits` 同步扩展（`%aI` 版）
  - `parseGitCommits` 解析新字段（len<4 老逻辑保留）
  - `loadGitCommitFiles` 增加 `git show --numstat` 第二次调用，按 path 合并 Added/Deleted
- [x] 1.3 `pkg/wshrpc/wshremote/vcs_test.go`：
  - parseGitCommits：新字段解析 + 旧格式（4 字段）兼容 + parents/refs 空串
  - loadGitCommitFiles numstat 合并（rename 不匹配 → 0）
- [x] 1.4 验证：`go test ./pkg/wshrpc/wshremote` → exit 0
- [x] 1.5 `node scripts/run-task.mjs generate` 刷新 `gotypes.d.ts` / `wshclientapi.ts`，diff 只含预期类型

### 阶段 2 · 前端算法

- [x] 2.1 `frontend/app/view/vcs/graph-layout.ts`：移植原型算法（typed）
- [x] 2.2 `frontend/app/view/vcs/graph-layout.test.ts`：6 个不变量用例
- [x] 2.3 验证：`npx vitest run frontend/app/view/vcs/graph-layout.test.ts` → exit 0

### 阶段 3 · 前端 UI

- [x] 3.1 `frontend/app/view/vcs/vcs-history-graph.tsx`：`CommitGraphCell` / `CommitGraphGutter` SVG 组件
- [x] 3.2 `frontend/app/view/vcs/vcs-history-tab.tsx` 重构：
  - refs 解析 + 徽章（分支色一致）、首字母头像、hash chip、hover 动作列
  - 行 grid：graph │ refs+subject │ hash │ author │ time │ actions
  - 展开面板：状态色 + ±统计 + diff 按钮；沟槽连线延续
  - 过滤/分页/右键菜单保留
- [x] 3.3 验证：`node scripts/check-tsc-baseline.mjs`（或等价 tsc 闸门）不抬高
- [x] 3.4 前端已有测试不红：`npx vitest run frontend/app/view/vcs/`

### 阶段 4 · 真机验收

- [x] 4.1 `node scripts/verify/index.mjs` 跑 vcs 对应 area（真机 Electron 截图：默认列表/展开/SVN 降级）
- [x] 4.2 结论一行入 `docs/project/verify-ledger.md`，明细/截图入 `verify-runs/`
- [x] 4.3 对照原型截图核对视觉（泳道/徽章/头像/展开统计）

### 阶段 5 · 收尾

- [x] 5.1 spec 更新（沉淀点：泳道算法契约 → `.trellis/spec/snorkeling-docs/frontend/`）
- [x] 5.2 原型 README 状态 ▲ → ◐（代码已落地）
- [x] 5.3 commit（feat(vcs): ...）

## 回滚点

- 每阶段独立可 revert；阶段 1 字段全 omitempty，无需回滚
- 阶段 3 出问题 → revert `vcs-history-tab.tsx` 即回到现状

## 风险

| 风险 | 缓解 |
|---|---|
| 真机无 merge/多分支仓库看不到 3 泳道 | 验收用本仓库（含 feat/i18n-rollout 等多分支历史） |
| numstat 与 name-status 的 rename path 不匹配 | 只精确匹配，宁缺不错（0 不渲染） |
| 行高变化影响既有布局 | 行高常量与 CSS 变量同源（46px） |
