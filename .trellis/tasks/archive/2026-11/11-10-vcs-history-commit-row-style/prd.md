# VCS History 块提交行样式对齐 Outgoing 两行式

## Goal

`vcshistory` 块（Changes 行「Show file history」打开的 File History 视图）的提交列表，视觉与交互对齐 `vcs-changes-tab` Remote 区 Outgoing 的两行式提交行，并把提交行抽取为共享组件供两处复用。

## Requirements

1. **抽取共享提交行组件** `frontend/app/view/vcs/vcs-commit-row.tsx`
   - 导出 `CommitRow`：保持 Outgoing 现有观感（左 2px 语义轨、subject 主行 `text-xs` truncate、副行 `font-mono` 短 hash + `·` + author + `·` 相对时间、`border-b border-border`、`hover:bg-hover`、`title` 全量）
   - 导出 `CommitGroup`（标题 11px semibold + 计数 chip + 右侧发丝线 + `rounded-[7px]` 容器），供 Incoming/Outgoing 继续使用
   - `vcs-changes-tab.tsx` 改为引用共享组件，删除本地 `RemoteCommitRow`/`RemoteCommitList`，Outgoing/Incoming 行为与像素不变
2. **可选参数**：`railColor`（默认不渲染轨）、`expandable` + `expanded` + `onToggle`（渲染 `▾/▸` 指示，整行可点，cursor-pointer）
3. **vcshistory 改造**
   - 提交行改用 `CommitRow`（`expandable`、`expanded`、`onToggle`）
   - 轨色用中性 `bg-secondary`（opacity 由组件统一 55%），**不复用** outgoing 绿 / incoming 红（避免方向语义混淆）
   - 时间：`formatRelativeTime(commit.date)`，绝对时间进 `title`（复用 `vcs-time.ts`），替换现在直接显示的原始 date 串
   - 展开面板（该 commit 的 files + 每行 Diff 按钮）保留在原行下方，样式沿用现有 `bg-surface-strong` 小容器，左缩进对齐内容列
   - 列表外层包 `CommitGroup`（标题 `History` + 计数 chip），空/加载/错误态文案不变
4. **不动**：RPC 调用（`RemoteVcsFileHistoryCommand` / `RemoteVcsCommitFilesCommand`）、展开状态与懒加载逻辑、`openDiff` 行为、Refresh 按钮、`vcsdiff` 块 meta。

## Non-goals

- 不改 Empty 状态、加载状态文案
- 不加 hover 复制 hash、不加行点击打开 diff（Outgoing 侧已有的 P2 另开项）
- 不接 `11-02-datetime-format-config` 格式配置，相对时间沿用 `vcs-time.ts` 现有输出

## Acceptance Criteria

- [x] `grep -n "RemoteCommitRow\|RemoteCommitList" frontend/app/view/vcs/vcs-changes-tab.tsx` = 0（定义已迁出）
- [x] `grep -n "CommitRow" frontend/app/view/vcshistory/vcshistory.tsx` ≥ 1（已接入共享组件）
- [x] `npx tsc --noEmit` 对 `vcs-commit-row.tsx` / `vcs-changes-tab.tsx` / `vcshistory.tsx` 0 error（仓内存量 47 处不计）
- [x] `npx vitest run frontend/app/view/vcs/` 全绿（24/24，含 `vcs-time.test.ts`）
- [x] `vcshistory.tsx` 不再出现 `commit.date` 直接渲染，改为 `formatRelativeTime` + `formatAbsoluteTime` title
- [x] 真机/verify：新增 area `scripts/verify/vcshistory-rows/verify.mjs`（两行式 + 2px 中性轨 + 分组头计数 chip + 行内展开面板断言，dry-run 解析通过）；真机执行 **skipped** —— nita 2026-11-10 明示「不需要真机验证」，台账已记 ◐ L1（用户自验，脚本留作回归）

## Notes

- 参照实现：`frontend/app/view/vcs/vcs-changes-tab.tsx`（原 L197-228 `RemoteCommitRow` / `RemoteCommitList`，已迁入共享组件）
- 改造对象：`frontend/app/view/vcshistory/vcshistory.tsx`（列表渲染段）
- 时间工具：`frontend/app/view/vcs/vcs-time.ts`（`formatRelativeTime` / `formatAbsoluteTime`）
- 上游任务：`11-09-vcs-remote-sync-widget`（Outgoing 两行式落地，已保证 `vcs-changes-tab` 无固定列宽）
- 实现偏离 PRD 一处：轨色实际用 `bg-accent`（中性强调色）而非 PRD 草写的 `bg-secondary`——与「中性、不用 outgoing 绿/incoming 红」的意图一致，视觉上更清晰；真机断言同步锁死不出现 `bg-success`/`bg-error`
- 2026-11-10：Outgoing/Incoming 迁共享组件后行为不变的关键点——`CommitRow` 非 expandable 分支的 subject 行仍是纯 `div.truncate.text-xs`（与旧 RemoteCommitRow 逐字节一致）；`CommitGroup` 标题/计数 chip/发丝线/圆角容器 class 原样投运
