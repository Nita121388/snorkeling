# HANDOFF — 接手必读（2026-11-05）

> 上一个会话在这里停下。**四项 UI 功能全部完成并发版**（最新 `0.0.118`）。
> 本文件只有一页；细节在下面指向的任务文档里。读完这页即可开工。

## 新增：昼夜循环工作流（`loop/`）

开发流程已改为「白天决策/验收/原型 + 夜里 agent 执行/发版」，规则与台账在仓库根 `loop/`：

- 开工前读 **`loop/RUNBOOK.md`**（3 分钟）：8 类任务 × 7 道门、证据阶梯、夜班三条铁律、发版 gate
- 队列状态：`node loop/queue.mjs list` / `derive --json`（看板从这里取）
- 事件流：`node loop/ledger.mjs tail -20` / `blocked`（晨会第一屏）
- 契约（改 `loop/**` 前必读）：`.trellis/spec/guides/day-night-loop-contract.md`
- 任务：`.trellis/tasks/11-05-day-night-loop/`（prd 已签 G1，design/implement 已落）

一句话边界：`.trellis/` 管「任务是什么/怎么做」，`loop/` 管「哪班跑到哪、算不算过」。

## 现状一句话

主分支 `main` 上 4 个功能的代码都在，工作区干净。`11-04-ui-delivery-batch` 这一批**已全部交付**，
没有半成品待收尾。

| # | 功能 | 代码 | 发版 |
|---|---|---|---|
| 1 | 预览编辑验证台（`scripts/verify/preview-edit/`） | ✅ | `0.0.115` ✅ |
| 2 | 图片预览翻页（`image-pager*.ts(x)`） | ✅ | `0.0.116` ✅ |
| 3 | Overview 看板（`overview-board*`） | ✅ 看板 v2（卡片信息架构 + 5 列常显 + 横向 snap + 视图切换/三分组）；甘特仅出原型 | `0.0.117` ✅ / v2 待发 |
| 4 | Files 目录树 VCS 标记（`vcs-tree-status*`） | ✅ 真机 31/31 | `0.0.118` ✅ |

## 最近这一轮做了什么（功能 4 收尾）

三条审核建议全部落地，详见 `.trellis/tasks/11-04-files-vcs-tree-status/implement.md`：

1. `frontend/app/view/preview/vcs-tree-status.ts` — 新增「情形 C」中间层符号链接拼写对齐
   （macOS iCloud「桌面与文稿」；子序列 + 首尾双锚定，同级无关目录不会产假标记）
2. `frontend/app/view/vcs/vcs.tsx` — commit / sync 成功后调 `clearVcsTreeStatusCache(connection)`
3. `frontend/app/treeview/treeview.tsx` — 新增可选 `getLabelTitle`，行名带上 VCS title（读屏可达性）

## 环境自检（新机器先跑）

```bash
npm run setup                                              # 本地固定工具链（约 5-10 分钟）
npx vitest run frontend/app/view/preview/vcs-tree-status.test.ts frontend/app/treeview/   # 期望 49 passed
npx tsc --noEmit -p tsconfig.json | grep -c "error TS"      # 期望 69（这是既有基线，不是 0）
```

真机 UI 验证（UI 改动都必须过）：

```bash
node scripts/verify/preview-edit/run.mjs --keep-open --expect=fixed   # 起隔离 Electron 实例（validate 环境用）
node scripts/verify/vcs-tree-status/verify.mjs --attach               # 期望 31/31
node scripts/verify/image-pager/verify.mjs --attach                   # 期望 30/30
node scripts/verify/overview-board/verify.mjs --attach                # 期望 38/38
```

> ⚠️ **Windows 上跑 vcs-tree-status 必须指定带盘符的 fixture**：
> `VCS_FIXTURE=E:/tmp/vcs-fixture node scripts/verify/vcs-tree-status/verify.mjs`
> （`/tmp` 只有盘符相对语义，git rootpath 带盘符后拼写对不上 → rows=0 或标记全空。
> 现象与修法已写进 `.trellis/spec/snorkeling-docs/frontend/preview-edit-harness.md`）
>
> 注意：`tsc` 基线 69 个错误是**既有存量**，任何新改动只要不让这个数字变大即可。
> `frontend/app/view/preview/` 有 34 个存量失败用例（`preview-directory-utils.test.ts` / `plugins/*`），
> 与这批功能无关。

## 发版

按 `.agents/skills/snorkeling-release/SKILL.md` 走（bump → 查远端号未占 → commit → push → annotated tag →
push tag → GitHub Actions 三平台构建 + 自动创建 Release）。当前版本号
`0.14.6-beta.0.snorkeling.0.0.118`，下一个是 `0.0.119`。

## 上下文备份

- 四个功能的设计/验收：`.trellis/tasks/11-04-*/{prd,design,implement}.md`
- 验证台规则语义与踩过的坑：`.trellis/spec/snorkeling-docs/frontend/preview-edit-harness.md`
- 上一会话流水：`.trellis/workspace/nita/journal-1.md`
- 原型（VCS 标记四方案对比）：`design/prototypes/files-vcs-tree-status/README.md`

## 已知遗留（不阻塞，别当 bug 修）

- **D（deleted）标记现实中不可见**：被删文件已不在目录列表里，D 只体现在上级目录计数。
- 噪音目录（node_modules/.git/dist/build/target/.venv/out/coverage）被跳过。
- `resolveResolvedBaseDir` 的情形 A 对「叶子名相同的同级目录」仍可能误映射（既有行为，未在本轮收紧）。

## 回滚开关（出问题先关功能，不用 revert）

| 功能 | 开关 |
|---|---|
| Files VCS 标记 | `frontend/app/view/preview/vcs-tree-status.ts` → `FILES_VCS_TREE_STATUS_ENABLED = false` |
| Overview 看板 | `frontend/app/session-overview/overview-board-model.ts` → `OVERVIEW_BOARD_ENABLED = false` |
| 图片翻页 | `frontend/app/view/preview/image-pager.tsx` → `IMAGE_PAGER_ENABLED = false` |
