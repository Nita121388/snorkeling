# VCS 块远程项目跳转：Repo Header / Remote 区 / 提交行

## Goal

版本管理 Block 增加跳转到远程托管页（GitHub / GitLab / Gitea / SVN 仓库根）的可见入口，让"这个仓库在网上的家"一键可达。数据层（`remoteurl` / `browseurl`）后端已就绪，本次纯前端接线。

## Background

- 后端已下发 `remoteurl` + `browseurl`（`pkg/wshrpc/wshremote/vcs.go` `loadGitRemoteUrls` / `loadSvnRemoteUrls` / `normalizeRepositoryBrowseUrl`），归一化为 `https://host/path`（支持 http(s)/ssh/git 协议与 `git@host:path` 形式）。
- 前端 `vcs.tsx:534` 已有完整的 `handleRepoContextMenu`（Copy Path / Copy URL / **Open Remote Repository**），但三 tab 重构后无任何挂载点，是死代码。

## Requirements

1. **[A] Repo Header 跳转按钮 + 右键菜单**（`frontend/app/view/vcs/vcs-tabs.tsx` `VcsRepoHeader`）
   - 分支区右侧、计数 chip 之前加一个 `VcsIconButton`（icon `external-link`，title `Open remote repository`），点击 `openLink(browseurl || remoteurl)`
   - `browseurl` 与 `remoteurl` 均空时按钮不渲染
   - Header 整行挂 `onContextMenu` → 复活 `handleRepoContextMenu`（把该 handler 从 `vcs.tsx` 迁到 `vcs-tabs.tsx` 或就近实现，vcs.tsx 删除死代码），菜单含 Copy Repository Path / Copy Repository URL / Open Remote Repository
2. **[A'] Changes·Remote 区 upstream 可点**（`vcs-changes-tab.tsx`）
   - upstream 字符串（现纯文本 `text-secondary` mono）改为可点击：hover 变 accent 色 + underline，点击 `openLink(browseurl || remoteurl)`；URL 均空时维持纯文本
3. **[B] History 提交行远程跳转**（`vcs-history-tab.tsx` + `vcs-commit-row.tsx`）
   - 仅 git：主行右端 hover 浮现 ↗ 小图标（`opacity-0 group-hover:opacity-100`），点击打开 `browseurl + "/commit/" + hash`
   - `CommitRow` 加可选 prop `remoteOpenUrl?: string`，有值时渲染同样的 ↗；`vcshistory.tsx`（File History 块）传入 `browseurl/commit/<hash>`，使其同步获得该能力
   - 右键提交行菜单：Copy Hash / Open Commit on Remote（git 且 browseurl 非空才显示）
4. URL 拼接收敛为小工具函数（如 `buildCommitRemoteUrl(browseUrl, hash)`），放 `vcs-filter.ts` 不合适则新建 `vcs-remote-url.ts` + 单测。

## Non-goals

- 不改后端（URL 采集已完备）
- 不做 host 特化 URL（GitHub PR/issue 猜测等）
- Changes tab 的 Incoming/Outgoing 提交行不加跳转（同步瞬态行，保持现状）
- 不动 `vcshistory` 的 RPC / 展开逻辑

## Acceptance Criteria

- [x] `grep -c "handleRepoContextMenu" frontend/app/view/vcs/vcs.tsx` = 0（死代码已迁到 `vcs-tabs.tsx` 并删除）
- [x] `VcsRepoHeader` 渲染 external-link 按钮（icon `arrow-up-right-from-square`），browseurl 为空时不渲染
- [x] `vcs-changes-tab.tsx` upstream 有 onClick + hover:text-accent/underline
- [x] History 提交行 + CommitRow（`remoteOpenUrl` prop）有远程跳转入口，URL 为空不渲染
- [x] `npx vitest run frontend/app/view/vcs/` 全绿（31/31，含新增 `vcs-remote.test.ts` 7 个用例）
- [x] `npx tsc --noEmit` 改动文件 0 新增 error（仓内存量 47 处基线不变）
- 真机 verify：**skipped** —— nita 2026-11-10 明示「暂时不需要真机跑本次」；`scripts/verify/vcs-panel-buttons/verify.mjs` 已加 repo-header-remote-jump / upstream-clickable 断言留作回归资产

## Notes

- icon 名采用 FA 的 `arrow-up-right-from-square`（`external-link` 是 FA5 名，项目统一用 FA6 sharp），与 PRD 草写不同但语义一致
