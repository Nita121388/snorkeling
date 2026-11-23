> **Confirmed: 2026-11-23 @nita**

# AISessions Hero 折叠组头只留 emoji（不画 fa-folder/folder-open）

## Goal

`frontend/app/view/aisessions/session-group.tsx` 的组头目前无条件画 `fa-folder` / `fa-folder-open`（`fa-inbox` 用于未归类）。
hero 组（`group.heroId != null`）应改为只显示 hero 自己的 emoji（回落 `🎭`）+ 组名，不再有文件夹图标。

## Requirements

### 做什么

1. `session-group.tsx` 组头图标分支：
   - `group.heroId != null` → 渲染 hero emoji（来自 hero roster 的 emoji；取不到时回落 `🎭`），**不渲染** `fa-folder` / `fa-folder-open`；
   - 普通项目组 → 保持 `fa-folder` / `fa-folder-open`（不回归）；
   - 未归类组（`group.unclassified`）→ 保持 `fa-inbox`（不受影响）。
2. emoji 取值走既有数据源（roster / group 上已有字段），不要在组件里新发 RPC；取不到就用 `🎭`。
3. 新增 ≥2 个用例：
   - hero 组头：emoji 节点 = 1，`fa-folder` / `fa-folder-open` 节点 = 0；
   - 普通项目组：icon 仍为 `fa-folder(-open)`，数量 1；未归类组仍是 `fa-inbox`。

### 不做什么

- 不改分组逻辑（`groupSessionsByProject` / `heroIdOfSession` 判定）。
- 不改组头其它元素（名称、计数、chevron、sticky/hover 样式）。
- 不动 `fa-inbox` 分支语义。

## Acceptance Criteria

- [ ] `npx vitest run frontend/app/view/aisessions` → 全绿（`passed`，无 failed）
- [ ] `npx vitest run frontend/app/view/aisessions/session-group.test.tsx` → 全绿，且新增用例 ≥2
- [ ] 红证：先写用例对现状必红，红输出存 `loop/red/N-1123-hero-group-emoji.txt`，再实现转绿
- [ ] 越界文件 0 处（仅 touch 白名单内）

## Notes

- 判据「命令 → 期望输出」；不吃"看起来对了"。
- 不提交、不记台账、不动看板（主 agent 收口）。
