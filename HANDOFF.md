# HANDOFF — 接手必读（2026-11-06 凌晨更新）

> 上一个会话在这里停下。最新发布 **`0.0.121`**（今晚连续发了 `0.0.119 / 0.0.120 / 0.0.121`）。
> 本文件只有一页；细节在下面指向的任务文档里。
> **夜间无人值守开发的逐段记录在 `docs/project/night-run.md`**（计划 / 约束 / 看板 / 已知红灯），
> 接手先看那一页，再看本页。

## 新增：昼夜循环工作流（`loop/`）

开发流程已改为「白天决策/验收/原型 + 夜里 agent 执行/发版」，规则与台账在仓库根 `loop/`：

- 开工前读 **`loop/RUNBOOK.md`**（3 分钟）：8 类任务 × 7 道门、证据阶梯、夜班三条铁律、发版 gate
- 队列状态：`node loop/queue.mjs list` / `derive --json`（看板从这里取）
- 事件流：`node loop/ledger.mjs tail -20` / `blocked`（晨会第一屏）
- 契约（改 `loop/**` 前必读）：`.trellis/spec/guides/day-night-loop-contract.md`
- 任务：`.trellis/tasks/11-05-day-night-loop/`（prd 已签 G1，design/implement 已落）
- 看板：`node E:/primary/projects/loop/board/scripts/start.mjs` → `http://127.0.0.1:7799`（只读/读写由 `LB_MODE` 决定；引擎与看板同仓）
- 第一个真实工作项：`N-1105-tab-hover-clip`（Tab 悬浮卡被截断）已走完 G2→prove→commit，停在 G7 等人验收

一句话边界：`.trellis/` 管「任务是什么/怎么做」，`loop/` 管「哪班跑到哪、算不算过」。

## 2026-11-06 深夜：Agent 卡片统一（chip 收口 + 跑时 + 标题编辑）

任务 `.trellis/tasks/11-06-agent-card-chip-title/`，提交 `1ee8db4b` + `b8550fc2`。

- **状态 chip 从 4 份实现收口成 1 份**：纯函数 `agent-status-chip-view.ts` 出 label/runtime/title/className，
  `AgentStatusChip` 按 `variant`（list/board/card/header/aggregate）只切几何与装饰；
  悬浮卡、看板、列表、Tab 聚合、Block 头部全部改读同一份。
- **运行时长**：`7s` / `3min21s` / `1h12min` / `2d3h`（不用 `00:07` 那种计时器样式）。
  1s 单例 tick **只有 chip 订阅**，面板 30s `useNow` 不动（那是性能红线）。
- **标题可编辑**：悬浮卡单击、放大弹窗双击；`renameTitle` → `service.Title` → note-cache 广播。
  改名成功后 ack `title-edit`，避免 `SetTitle` bump `UpdatedAt` 把 idle 会话误点亮成 Done。
- 判据：`agent-status` 260 · `view/term` 196 · `store` 100 · `info-card` 53 · `session-overview` 140 · `modals` 39。
- **已知红灯**：真机台 `agent-card-seen` 25/26 —— `title-edit-in-dialog` 红，因为悬浮卡的放大按钮
  在真实指针下被 xterm 的 link-layer canvas 盖住（JS `click()` 正常）。属 `info-card` 层级/命中问题
  （与 `11-06-tab-hover-clip` 同源），需另开包。

## 现状一句话

主分支 `main` 上 4 个功能的代码都在，工作区干净。`11-04-ui-delivery-batch` 这一批**已全部交付**，
没有半成品待收尾。

| # | 功能 | 代码 | 发版 |
|---|---|---|---|
| 1 | 预览编辑验证台（`scripts/verify/preview-edit/`） | ✅ | `0.0.115` ✅ |
| 2 | 图片预览翻页（`image-pager*.ts(x)`） | ✅ | `0.0.116` ✅ |
| 3 | Overview 看板（`overview-board*`） | ✅ 看板 v2：卡片信息架构 + 5 列常显 + 横向 snap + 列表/看板/时间线三视图 + 状态/Tab/Provider 三分组 | `0.0.117` → v2 已在 `0.0.119` ✅ |
| 5 | Overview 时间线（Gantt · G1 会话寿命条，`overview-timeline*`） | ✅ 真机 22/22 | `0.0.119` ✅ |
| 4 | Files 目录树 VCS 标记（`vcs-tree-status*`） | ✅ 真机 31/31 | `0.0.118` ✅ |

## 最近这一轮做了什么（功能 4 收尾）

三条审核建议全部落地，详见 `.trellis/tasks/11-04-files-vcs-tree-status/implement.md`：

1. `frontend/app/view/preview/vcs-tree-status.ts` — 新增「情形 C」中间层符号链接拼写对齐
   （macOS iCloud「桌面与文稿」；子序列 + 首尾双锚定，同级无关目录不会产假标记）
2. `frontend/app/view/vcs/vcs.tsx` — commit / sync 成功后调 `clearVcsTreeStatusCache(connection)`
3. `frontend/app/treeview/treeview.tsx` — 新增可选 `getLabelTitle`，行名带上 VCS title（读屏可达性）

## 2026-11-05 夜间批次（已发 `0.0.119 / 0.0.120 / 0.0.121`）

一、**Overview 看板 v2 + 时间线 G1**
- 卡片信息架构（emoji 头像 / 会话标题链 / 共享 `AgentStatusChip` / note 行）、5 列常显 + 横向 snap、
  三视图切换 + 三分组；时间线 = 会话寿命条（当前状态色尾巴 + 斜纹历史段 + 2h/8h/24h/7d + 40 行上限汇总）

二、**验证不再依赖人眼**
- `overview-timeline` 长条形态改为机器判定（播种真实 `createdAt/updatedAt`，断言条宽 0.563 / 斜纹 / 尾巴）
- `preview-edit` 修掉"clip 截图静默返回空片"→ 假红/假绿（新增文本区墨迹为 0 → 整窗重拍）
- `npm test` 从「12 files failed / exit 1」变 **227 files / 2532 tests passed / exit 0**
- 新增 tsc 类型债闸门 `scripts/check-tsc-baseline.mjs`（**69 → 47**）
- 台账 bug：`fatal()` 曾被记成 `✅ 0/0`（环境错误显示为通过）→ 现在一律 `❌ fatal（未跑）`
- 验证台默认档位支持 `VERIFY_PROFILE` / `VERIFY_VITE_PORT` / `VERIFY_CDP_PORT` 环境变量（并行跑台子不用改代码）

三、**修掉的真 bug**（都有回归锁）
- 三级菜单 hover 必崩（`ReferenceError: hoverHandlers`）· 预览「用系统应用打开」必崩（未导入 `getApi`）
- 消息弹窗「删除块」必崩（没有接 `onDeleteBlock`）· 预览「在树里定位」静默失效（用了 `Block.id` 应为 `oid`）
- HTML 打开模式丢失目录根（菜单选项被当预览选项）· 导出 HTML 目录全是死链（缺 `rehype-slug`）
- 导出 `bodyOnly` 是空操作 / `<title>` 恒为空 · 导出产物里混进预览专用「加 emoji」按钮

四、**已知红灯（都不是产品坏了，属各自 in_progress 任务）**
- `image-pager` ✅ 32/32（已修断言时机）
- `agent-card-seen` ❌ 起不来：全新 profile 下 New Agent 面板未展开（`11-05-agent-card-seen`）

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
node scripts/verify/overview-timeline/verify.mjs                        # 期望 22/22（时间线，含长条宽度判定）
node scripts/verify/preview-edit/run.mjs --expect=fixed                 # 期望 5/5
node scripts/verify/image-pager/verify.mjs                              # 期望 32/32
npx vitest run                                                          # 期望 227 files / 2532 passed
node scripts/check-tsc-baseline.mjs                                     # 期望等于基线（当前 47）
node --test "scripts/**/*.test.mjs" "tests/**/*.test.mjs"               # 期望 23 passed
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
