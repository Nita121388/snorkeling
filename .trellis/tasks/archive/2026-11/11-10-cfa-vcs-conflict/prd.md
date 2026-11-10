# VCS：合并冲突与 push 被拒复制给 agent

> 父任务：11-10-copy-for-agent
> 依赖：cfa-core
> 关联：11-10-vcs-remote-jump / 11-09-vcs-remote-sync-widget（同 VCS 面，注意同文件冲突）

## Background

两处高频且高度同构的「解释半天」：

1. **合并冲突**：`git status` 的 unmerged 文件 + 冲突标记片段。`frontend/app/view/preview/conflict-copy.ts`
   的 `buildConflictCopyText()` 已解决「文件保存冲突」这一种（base→mine / base→theirs 双 diff +
   "Please analyze both changes and output the merged, complete file content."），
   但 **git 合并冲突（`<<<<<<< / ======= / >>>>>>>`）没有入口**。
2. **push 被拒**：保护分支 / 权限 / non-fast-forward / hook 拒绝，判断全靠 git stderr 原文，
   用户转述时必然丢信息。

同时 `buildConflictCopyText` 自成一套格式（无 Output contract 小节），应迁到共享契约，
避免第四套格式。

## Goal

VCS 面板在「有未解决合并冲突」与「push/commit 失败」两种状态下各给一个 `Copy for agent`，
并把既有 `buildConflictCopyText` 收口到 `buildAgentPayload`。

## Requirements

### R1 push/commit 失败复制

- VCS 操作结果条（`frontend/app/view/vcs/vcs.tsx` 的 `VcsOperationPanel` 一带，状态 `failed`）右侧
  `<CopyForAgent>`：payload = Context（action / 命令 / cwd / branch / stderr 全文或末 N 行 / 退出码）
  + Task（"Diagnose why the git operation failed and name the smallest fix"）+ `FIX_COMMAND_ONLY`。
- stderr 优先取全文；超过 200 行截断并标注。

### R2 合并冲突复制

- 有 unmerged 文件时，VCS 变更区顶部出现冲突条（对齐既有失败条视觉），右侧 `<CopyForAgent>`：
  payload = Context（unmerged 文件列表 + 每个文件冲突标记片段，单文件片段上限 60 行）
  + Task（"Resolve these merge conflicts and output only the resolved file contents"）
  + `MERGED_CONTENT_ONLY`（多文件时逐个用 `=== path ===` 分段，便于回填）。
- 冲突标记片段按 `<<<<<<<` / `=======` / `>>>>>>>` 边界截取，只取冲突块 ±3 行上下文（与
  `conflict-copy.ts` 的 `context: 3` 对齐）。

### R3 迁移既有实现

- `buildConflictCopyText()` 改为内部调用 `buildAgentPayload`，输出小节与共享契约一致；
  保持向后兼容：既有调用点（`file-conflict-modal.tsx` 的 `copy-diff`）签名不变。
- 迁移后该文件的单测与 file-conflict-modal 的快照/断言仍全绿。

## Acceptance（命令 → 期望输出）

- [x] `npx vitest run frontend/app/view/preview/conflict-copy.test.ts` + `frontend/app/view/vcs/` → 全绿（冲突域 10 + VCS 域 36 共 46）。
- [x] 新增 ≥ 5 用例：单文件冲突片段截取（±3 行上下文）、多文件 `=== path ===` 分段、stderr 200 行截断、无冲突码不渲染（isUnmergedCode 表）、迁移后仍含 Task/Output contract 段。另含单文件 60 行上限、无标记 throw 两个防御用例。
- [x] 手工造冲突（双分支改同一行 → merge 冲突）→ 点复制 → 粘贴文本含 `<<<<<<<` / `=======` / `>>>>>>>`，`### Output contract` = 1（真机 verify `merge-payload-*` 锁死）。
- [x] push 被拒（amend 后非快进）→ 复制文本含 stderr 原文（`! [rejected]` / non-fast-forward，真机 verify `push-payload-rejected-line`）与 `action: push` / `repo:` / `stderr (`。
- [x] 真机验证台：新 area `scripts/verify/vcs-conflict-copy/verify.mjs` → **17/17 全绿**（launch+reset，真实 git 仓库驱动），台账已记；area 已登记 README。

## 实施偏离与附带修复（2026-11-10）

- 冲突条放在共享进度卡同层的 VCS 视图共享区（而非 Changes 面内）：vcs-changes-tab.tsx 不在本任务白名单；视觉效果与失败条同规格（同色同圆角）。push/commit 失败卡与冲突条共存。
- Context 未含 branch / exit code：`VcsOperationInfo` 只有 action/message/details（后端 RPC 不返回退出码与分支）；repo 路径已含。
- 真机挖出一个真 bug 并修：VcsConflictBar 的 `FileReadCommand` 传了 `route: "conn:local"` 会让 fileread 静默失败（本地连接不传 route，远程才带 conn 路由）。

## Touch（白名单）

- `frontend/app/view/preview/conflict-copy.ts`（迁移到共享契约）
- `frontend/app/view/vcs/vcs.tsx`（冲突条 + 失败条复制按钮）
- `frontend/app/view/vcs/*.test.tsx`、`frontend/app/view/preview/conflict-copy*.test.ts`
- `frontend/app/modals/file-conflict-modal.tsx`（如需同步文案）

## Out of Scope

- 自动合并 / 自动 abort / 自动重推。
- git 图/历史区展示（属 11-10-vcs-* 其它任务）。
