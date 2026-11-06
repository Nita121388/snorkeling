---
id: N-1105-cmd-window-flash
title: "打开看板闪黑窗：子进程漏 windowsHide"
type: bug
priority: P1
status: open
origin: self
source: "nita 2026-11-05 报：打开看板闪几个命令窗口"
task: null
order: 100
touch: ["E:/primary/projects/loop-board/server/lib/version.mjs", "E:/primary/projects/loop-board/scripts/**", "E:/primary/projects/loop/queue.mjs", "E:/primary/projects/loop/lib/**"]
rollback: null
budget: {minutes: 30, retries: 2}
releaseCandidate: false
createdAt: "2026-11-06T00:50:19Z"
---

# 打开看板闪黑窗：子进程漏 windowsHide

## 背景

看板服务无控制台启动；/api/version 走 readGitState 连起 4 个 git 子进程，全都没 windowsHide → 一个调用一个新控制台窗口一闪而过。引擎作为孙进程同样中招（queue.mjs 的 git、prove 的 execSync）。

## 来源

- self：nita 2026-11-05 报：打开看板闪几个命令窗口

## 验收判据

- [ ] `cd E:/primary/projects/loop-board && npm run lint` → `lint ok`
- [ ] `cd E:/primary/projects/loop-board && node --test server/lib/spawn-guard.test.mjs` → `pass 6`
- [ ] `cd E:/primary/projects/loop && node --test lib/spawn-guard.test.mjs` → `pass 3`

判据核心：静态扫描全仓源码，任何 `execFileSync/execSync/spawn/execFile` 调用缺 `windowsHide: true` 即红。
校准：BAD 样本是修复前 `server/lib/version.mjs` 的真实调用行，守卫必须抓到它。

## 记录

- 2026-11-05 根因：`/api/version` → `readGitState` 连起 4 个 `git` 子进程（rev-parse HEAD / --abbrev-ref / status --porcelain / --show-toplevel），
  全都没带 `windowsHide`。看板是 detached 启动（无控制台），于是每个子进程新建一个控制台窗口，页面一加载就闪 4 下。
- 同源隐患：引擎作为孙进程（看板 execFile 引擎时带了 windowsHide）自己再起 git/python 也没带 —— 孙进程照样闪。
- 修法：静态守卫 `spawn-guard.mjs`（两个仓库各一份）+ 挂进看板 lint。一挂上就抓出 17 处同样的隐患。
- 遗留（值得单独立项）：跨仓工作项没法用相对白名单表达，本包 touch 只能写绝对路径 —— 多仓工作项的 `touch` 语义还没设计。
