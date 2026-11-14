# 真机验证台账

> 由 `scripts/verify/lib/report.mjs` 自动追加，**不要手改历史行**。
> 明细与截图在 `verify-runs/<ts>-<area>/`（gitignore），这里只留结论。
> 查看索引：`node scripts/verify/index.mjs`

| 时间 | area | 结论 | 模式 | 证据目录 | commit |
| --- | --- | --- | --- | --- | --- |
| 2026-11-05 05:44 | agent-card-seen | ✅ 21/21 | launch+reset | `20261105T05392-agent-card-seen` | 7cc74a30 |
| 2026-11-05 06:47 | agent-card-seen | ✅ 21/21 | launch+reset | `20261105T06423-agent-card-seen` | 04ac4722 |
| 2026-11-05 06:53 | preview-edit | ✅ 5/5 | --expect=fixed / rpc | `20261105-145318` | working-tree |
| 2026-11-05 08:40 | info-card 悬浮卡定位（新判据，非 verify 台） | ✅ 10/10 + 校准 3 例红 | vitest | `info-card-pos.test.ts` | ec327a59 |
| 2026-11-05 11:03 | property-editor | ✅ 13/13 | launch+reset | `20261105T11021-property-editor` | working-tree |
| 2026-11-05 11:59 | overview-board | ✅ 28/28 | launch+reset | `20261105T11582-overviewboard` | working-tree |
| 2026-11-05 12:04 | vcs-panel-buttons | ❌ 3/5 | attach | `20261105T12044-vcs-panel-buttons` | 2a7f07a0 |
| 2026-11-05 12:08 | vcs-panel-buttons | ✅ 5/5 | attach | `20261105T12084-vcs-panel-buttons` | 2a7f07a0 |
| 2026-11-05 12:13 | vcs-panel-buttons | ✅ 14/14 | attach | `20261105T12134-vcs-panel-buttons` | 2a7f07a0 |
| 2026-11-05 13:06 | overview-board | ✅ 38/38 | launch+reset | `20261105T13054-overviewboard` | working-tree |
| 2026-11-05 11:55 | commontext-meta-sort | ✅ 21/21 | launch+reset | `20261105T11533-commontext-meta-sort` | 63fa01a5 |
| 2026-11-05 12:09 | commontext-meta-sort | ✅ 21/21 | launch+reset | `20261105T12083-commontext-meta-sort` | ff717c17 |
| 2026-11-05 12:21 | commontext-meta-sort | ✅ 27/27 | launch+reset | `20261105T12211-commontext-meta-sort` | ff717c17 |
| 2026-11-05 13:15 | commontext-meta-sort | ✅ 28/28 | launch+reset | `20261105T13145-commontext-meta-sort` | 87353099 |
| 2026-11-05 13:20 | commontext-meta-sort | ✅ 28/28 | launch+reset | `20261105T13193-commontext-meta-sort` | 241c296c |
| 2026-11-05 14:28 | overview-board | ✅ 38/38 | launch+reset | `20261105T14274-overviewboard` | working-tree |
| 2026-11-05 14:55 | overview-timeline | ✅ 22/22 | launch+reset | `20261105T14534-overview-timeline` | ed6a61e3 |
| 2026-11-05 19:19 | overview-timeline | ✅ 22/22 | launch+reset | `20261105T19185-overview-timeline` | 96e6255b |
| 2026-11-05 20:01 | image-pager | ✅ 32/32 | launch+reset | `20261105T19595-imagepager` | working-tree |
| 2026-11-05 20:08 | vcs-tree-status | ✅ 31/31 | launch+reset | `20261105T20074-vcstreestatus` | working-tree |
| 2026-11-05 20:20 | overview-board | ✅ 38/38 | launch+reset | `20261105T20185-overviewboard` | working-tree |
| 2026-11-06 05:30 | overview-board | ❌ 38/43 | attach | `20261106T05294-overviewboard` | working-tree |
| 2026-11-06 06:45 | overview-board | ❌ 24/43 | attach | `20261106T06444-overviewboard` | working-tree |
| 2026-11-06 07:10 | overview-board | ❌ 32/43 | attach | `20261106T07095-overviewboard` | working-tree |
| 2026-11-06 11:05 | agent-card-tags | ❌ fatal（未跑） | launch+reset | `20261106T10580-agent-card-tags` | 46c36ada |
| 2026-11-06 12:19 | agent-card-tags | ❌ 6/9 | launch+reset | `20261106T12122-agent-card-tags` | 46c36ada |
| 2026-11-06 12:27 | agent-card-tags | ❌ 7/10 | attach | `20261106T12265-agent-card-tags` | 46c36ada |
| 2026-11-06 12:37 | agent-card-tags | ❌ 7/10 | attach | `20261106T12372-agent-card-tags` | 46c36ada |
| 2026-11-06 12:42 | agent-card-tags | ❌ 6/8 | attach | `20261106T12421-agent-card-tags` | 46c36ada |
| 2026-11-06 12:45 | agent-card-tags | ❌ 5/8 | launch+reset | `20261106T12445-agent-card-tags` | 46c36ada |
| 2026-11-06 12:59 | agent-card-tags | ✅ 13/13 | attach | `20261106T12590-agent-card-tags` | 46c36ada |
| 2026-11-06 13:01 | agent-card-tags | ❌ 10/13 | launch+reset | `20261106T13012-agent-card-tags` | 46c36ada |
| 2026-11-06 13:12 | agent-card-seen | ❌ fatal（未跑） | launch+reset | `20261106T13122-agent-card-seen` | 46c36ada |
| 2026-11-06 13:16 | agent-card-tags | ✅ 13/13 | launch+reset | `20261106T13164-agent-card-tags` | 46c36ada |
| 2026-11-06 13:26 | agent-card-seen | ❌ fatal（未跑） | attach | `20261106T13264-agent-card-seen` | 46c36ada |
| 2026-11-06 13:38 | agent-card-seen | ❌ fatal（未跑） | launch+reset | `20261106T13310-agent-card-seen` | 46c36ada |
| 2026-11-06 14:42 | agent-card-seen | ❌ fatal（未跑） | launch+reset | `20261106T14350-agent-card-seen` | 1ee8db4b |
| 2026-11-06 14:53 | agent-card-seen | ❌ 22/26 | launch+reset | `20261106T14521-agent-card-seen` | 1ee8db4b |
| 2026-11-06 14:54 | overview-board | ❌ 38/43 | launch+reset | `20261106T14532-overviewboard` | working-tree |
| 2026-11-06 15:03 | agent-card-seen | ❌ 15/26 | launch+reset | `20261106T15013-agent-card-seen` | 1ee8db4b |
| 2026-11-06 15:14 | agent-card-seen | ❌ 25/26 | launch+reset | `20261106T15065-agent-card-seen` | e4e912a4 |
| 2026-11-06 15:18 | agent-card-seen | ❌ fatal（未跑） | launch+reset | `20261106T15170-agent-card-seen` | e4e912a4 |
| 2026-11-06 15:19 | agent-card-seen | ❌ fatal（未跑） | launch+reset | `20261106T15183-agent-card-seen` | e4e912a4 |
| 2026-11-06 15:20 | agent-card-seen | ❌ fatal（未跑） | launch+reset | `20261106T15202-agent-card-seen` | e4e912a4 |
| 2026-11-06 15:23 | agent-card-seen | ❌ fatal（未跑） | launch+reset | `20261106T15222-agent-card-seen` | e4e912a4 |
| 2026-11-06 15:28 | agent-card-seen | ❌ fatal（未跑） | launch+reset | `20261106T15272-agent-card-seen` | e4e912a4 |
| 2026-11-06 15:32 | agent-card-seen | ❌ fatal（未跑） | launch+reset | `20261106T15313-agent-card-seen` | e4e912a4 |
| 2026-11-06 15:34 | agent-card-seen | ❌ fatal（未跑） | launch+reset | `20261106T15332-agent-card-seen` | e4e912a4 |
| 2026-11-06 15:36 | agent-card-seen | ❌ 17/26 | attach | `20261106T15354-agent-card-seen` | e4e912a4 |
| 2026-11-06 15:44 | agent-card-seen | ❌ 25/26 | launch+reset | `20261106T15383-agent-card-seen` | e4e912a4 |
| 2026-11-06 15:53 | agent-card-seen | ❌ 25/26 | launch+reset | `20261106T15463-agent-card-seen` | e4e912a4 |
| 2026-11-06 15:58 | agent-card-seen | ❌ 17/26 | launch+reset | `20261106T15570-agent-card-seen` | e4e912a4 |
| 2026-11-06 16:08 | overview-board | ❌ 40/47 | launch+reset | `20261106T16071-overviewboard` | working-tree |
| 2026-11-06 16:11 | agent-card-seen | ❌ 23/26 | launch+reset | `20261106T16094-agent-card-seen` | 022b689e |
| 2026-11-06 16:11 | overview-board | ❌ 31/47 | launch+reset | `20261106T16110-overviewboard` | working-tree |
| 2026-11-06 16:14 | overview-board | ❌ 36/47 | launch+reset | `20261106T16121-overviewboard` | working-tree |
| 2026-11-06 16:21 | overview-board | ❌ 44/47 | launch+reset | `20261106T16145-overviewboard` | working-tree |
| 2026-11-06 16:28 | overview-board | ✅ 47/47 | launch+reset | `20261106T16225-overviewboard` | working-tree |
| 2026-11-06 16:41 | overview-board | ✅ 51/51 | launch+reset | `20261106T16354-overviewboard` | working-tree |
| 2026-11-06 17:07 | overview-board | ✅ 54/54 | launch+reset | `20261106T17012-overviewboard` | working-tree |
| 2026-11-06 17:12 | overview-timeline | ❌ 24/27 | launch+reset | `20261106T17074-overview-timeline` | aa121542 |
| 2026-11-06 17:19 | overview-timeline | ❌ 25/27 | launch+reset | `20261106T17141-overview-timeline` | aa121542 |
| 2026-11-06 17:26 | overview-timeline | ❌ 25/27 | launch+reset | `20261106T17205-overview-timeline` | aa121542 |
| 2026-11-06 17:32 | overview-timeline | ❌ 26/27 | launch+reset | `20261106T17272-overview-timeline` | aa121542 |
| 2026-11-06 17:39 | overview-timeline | ✅ 27/27 | launch+reset | `20261106T17332-overview-timeline` | aa121542 |
| 2026-11-07 03:49 | theme-monochrome | ✅ 1/1 | launch+reset | `20261107T03493-theme-monochrome` | a43a7749 |
| 2026-11-07 03:55 | theme-monochrome | ✅ 5/5 | launch+reset | `20261107T03494-theme-monochrome` | a43a7749 |
| 2026-11-07 06:43 | commontext-source-notion | ❌ fatal（未跑） | launch+reset | `20261107T06361-commontext-source-notion` | ea7c5775 |
| 2026-11-07 06:45 | commontext-source-notion | ❌ fatal（未跑） | attach | `20261107T06443-commontext-source-notion` | ea7c5775 |
| 2026-11-07 06:54 | commontext-source-notion | ❌ fatal（未跑） | launch+reset | `20261107T06463-commontext-source-notion` | ea7c5775 |
| 2026-11-07 07:05 | commontext-source-notion | ❌ fatal（未跑） | attach | `20261107T07043-commontext-source-notion` | ea7c5775 |
| 2026-11-07 09:46 | commontext-source-notion | ❌ 1/1（fatal） | attach | `20261107T09460-commontext-source-notion` | ea7c5775 |
| 2026-11-07 09:47 | commontext-source-notion | ❌ 1/1（fatal） | attach | `20261107T09463-commontext-source-notion` | ea7c5775 |
| 2026-11-07 09:49 | commontext-source-notion | ❌ 17/19 | attach | `20261107T09474-commontext-source-notion` | ea7c5775 |
| 2026-11-07 09:52 | header-hover-latch | ✅ 1/1 | launch+reset | `20261107T09523-header-hover-latch` | ea7c5775 |
| 2026-11-07 09:56 | aisessions-run-indicator | ✅ 1/1 | launch+reset | `20261107T09560-aisessions-run-indicator` | ea7c5775 |
| 2026-11-07 09:57 | commontext-source-notion | ❌ 16/19 | attach | `20261107T09552-commontext-source-notion` | ea7c5775 |
| 2026-11-07 09:59 | aisessions-run-indicator | ❌ fatal（未跑） | launch+reset | `20261107T09561-aisessions-run-indicator` | ea7c5775 |
| 2026-11-07 09:59 | aisessions-run-indicator | ❌ fatal（未跑） | launch+reset | `20261107T09584-aisessions-run-indicator` | ea7c5775 |
| 2026-11-07 10:00 | header-hover-latch | ❌ fatal（未跑） | launch+reset | `20261107T09525-header-hover-latch` | ea7c5775 |
| 2026-11-07 10:01 | commontext-source-notion | ❌ fatal（未跑） | attach | `20261107T10001-commontext-source-notion` | ea7c5775 |
| 2026-11-07 10:05 | commontext-source-notion | ❌ fatal（未跑） | attach | `20261107T10042-commontext-source-notion` | ea7c5775 |
| 2026-11-07 10:07 | header-hover-latch | ❌ fatal（未跑） | launch+reset | `20261107T10032-header-hover-latch` | ea7c5775 |
| 2026-11-07 10:08 | aisessions-run-indicator | ❌ fatal（未跑） | attach | `20261107T10075-aisessions-run-indicator` | ea7c5775 |
| 2026-11-07 10:10 | commontext-source-notion | ❌ fatal（未跑） | launch+reset | `20261107T10072-commontext-source-notion` | ea7c5775 |
| 2026-11-07 10:16 | header-hover-latch | ❌ fatal（未跑） | launch+reset | `20261107T10092-header-hover-latch` | ea7c5775 |
| 2026-11-07 10:18 | commontext-source-notion | ❌ fatal（未跑） | launch+reset | `20261107T10111-commontext-source-notion` | 52556187 |
| 2026-11-07 10:20 | commontext-source-notion | ❌ fatal（未跑） | attach | `20261107T10192-commontext-source-notion` | 52556187 |
| 2026-11-07 10:22 | commontext-source-notion | ❌ 18/21 | attach | `20261107T10205-commontext-source-notion` | 52556187 |
| 2026-11-07 10:24 | commontext-source-notion | ❌ 20/22 | attach | `20261107T10232-commontext-source-notion` | 52556187 |
| 2026-11-07 10:26 | commontext-source-notion | ❌ 20/22 | attach | `20261107T10245-commontext-source-notion` | 52556187 |
| 2026-11-07 10:31 | commontext-source-notion | ❌ 20/22 | attach | `20261107T10300-commontext-source-notion` | 52556187 |
| 2026-11-07 10:47 | commontext-source-notion | ❌ fatal（未跑） | attach | `20261107T10472-commontext-source-notion` | 52556187 |
| 2026-11-08 06:20 | overview-timeline | ❌ fatal（未跑） | launch+reset | `20261108T06185-overview-timeline` | aedc7fe1 |
| 2026-11-08 06:36 | overview-timeline | ❌ fatal（未跑） | launch+reset | `20261108T06284-overview-timeline` | aedc7fe1 |
| 2026-11-08 06:42 | overview-timeline | ❌ fatal（未跑） | launch+reset | `20261108T06412-overview-timeline` | aedc7fe1 |
| 2026-11-08 07:28 | agent-card-seen | ❌ fatal（未跑） | launch+reset | `20261108T07210-agent-card-seen` | 557d5109 |
| 2026-11-08 08:01 | agent-card-seen | ❌ fatal（未跑） | launch+reset | `20261108T07590-agent-card-seen` | 0016e987 |
| 2026-11-08 08:07 | agent-card-seen | ❌ fatal（未跑） | launch+reset | `20261108T08003-agent-card-seen` | 0016e987 |
| 2026-11-08 08:09 | agent-card-seen | ❌ fatal（未跑） | attach | `20261108T08082-agent-card-seen` | 0016e987 |
| 2026-11-08 | acs-p02（新 area，非 verify 台） | ◑ 7 过 / 1 环境阻塞（AC7 FE 渲染）；syncState 误报已修 | CDP RpcApi + go test | `verify-runs/2026-11-08-acs-p02.md` | 7866de53 |
| 2026-11-09 | commontext-sync-watermark（无 verify 台） | ◑ L1：6/6 判据绿（go test 6 包 · watermark 5 用例 · engine 5 用例 · vitest commontext 133 passed · tsc 47=基线 · go vet 干净）；真机双设备联调 skipped（用户自验） | loop prove | `loop/LEDGER-2026-11.jsonl` | 见本次提交 |
| 2026-11-09 | overview board（无状态空标签） | ◑ L1：vitest 64 passed / 0 failed（新增 8 例 = 纯函数 4 + jsdom DOM 4）· loop prove 3/3 绿 · tsc 47=基线（改动文件 0 error）· 红证→绿证同一用例；真机 CDP/Electron **skipped（用户自验）**，断言 `board-no-empty-view-label` + `board-view-labels-preserved` 已留在 verify 台 | vitest + loop prove | `loop/red/N-1109-overview-board-empty-status-label.txt` | 未提交（G7 待签） |
| 2026-11-09 | overview board（chip A 美化） | ◐ L1：loop prove 3/3 绿（session-overview suite 全绿 · 静态探针 · 原型入索引）；原型 before/after 截图实测 `54.1×16.6` → `62.6×16.5` px（高度差 0.1px）；真机观感 **skipped（用户自验）** | loop prove + Edge headless 截图 | `verify-runs/proto-shots/board-chip-polish-light.png` | 未提交（G1/G3/G4/G7 待签） |
| 2026-11-09 | vcs-remote-sync-widget（Remote 区同步条 + 两行式提交行） | ◑ L1：vitest `frontend/app/view/vcs/` 24 passed / 0 failed（新增 `vcs-time.test.ts` 11 例）· tsc 改动文件 0 error（47=存量基线）· 判据「`RemoteCommitRow` 无固定列宽」grep = 0；真机 470px 截图 + `vcs-panel-buttons` 台子 **skipped（用户 11-09 要求先提交推送，回家后补）** | vitest + tsc + grep | `design/prototypes/vcs/vcs-remote-sync-widget/` | 0cde4f6f |
| 2026-11-09 07:58 | vcs-panel-buttons | ⏭ skipped（attach 到实例但 `hasTab=false blocks=0`，用户要求先提交，未重跑） | attach | `20261109T07584-vcs-panel-buttons` | f8f092ad |
| 2026-11-09 | inline-tab 更多下拉（删除不关菜单、连续删除） | ◑ L1：vitest 14/14（本文件）+ 相关面 37/37 · eslint 0 error（1 条存量 warning）· tsc 改动文件 0 error；真机 Electron/verify 台 **skipped（无对应 area，菜单需 >1 内联 Tab 且溢出才出现）** | vitest + eslint + tsc | `frontend/app/block/inlinetab-dropdown.test.tsx` | 见本次提交 |
| 2026-11-09 | commontext 详情编辑区遮挡（无新 area，复用 `commontext-meta-sort`） | ✅ L1+真机 CDP：dev 实例（electron-vite dev 51742 / CDP 9222）实测修复后 `scrollHeight 568 > clientHeight 426`（详情列内部滚动生效）、textarea 底 725 < All tags 顶 735（零重叠，修复前 200px 硬撑出槽位）、包裹层 `min-h-[200px]` + textarea `minH 0px`；vitest `frontend/app/commontext` 99 passed · tsc 改动文件 0 error（47=存量基线） | CDP 实测量 + vitest + tsc | 本台账 | 见本次提交 |
| 2026-11-09 14:38 | overview-board | ✅ 71/71 | launch+reset | `20261109T14362-overviewboard` | working-tree |
| 2026-11-10 | vcshistory 提交行两行式对齐（新增 area `vcshistory-rows`） | ◑ L1：vitest `frontend/app/view/vcs/` 24/24 · tsc 改动文件 0 error（47=存量基线）· 行容器 class 与共享 CommitRow 逐字一致（`frontend/app/view/vcs/vcs-commit-row.tsx`）；真机 Electron/verify 台 **skipped（用户自验：nita 2026-11-10 明示「不需要真机验证」；脚本已就绪待回归）** | vitest + tsc + class 一致性 | 本台账 + `scripts/verify/vcshistory-rows/verify.mjs` | 见本次提交 |
| 2026-11-10 | vcs 远程跳转入口（复用 area `vcs-panel-buttons`，新增 repo-header-remote-jump / upstream-clickable 断言） | ◑ L1：vitest `frontend/app/view/vcs/` 31/31（含 `vcs-remote.test.ts` 7 新用例）· eslint 改动文件 0 error · tsc 改动文件 0 新增 error（47=存量基线）；真机 verify **skipped**（nita 2026-11-10 明示「暂时不需要真机跑本次」；断言已入脚本待回归） | vitest + eslint + tsc | 本台账 + `scripts/verify/vcs-panel-buttons/verify.mjs` | 见本次提交 |
| 2026-11-10 11:04 | sync-conflict-copy | ✅ 14/14 | launch+reset | `20261110T11010-sync-conflict-copy` | 777d87b6 |
| 2026-11-10 11:24 | sync-diagnostics-copy | ❌ 15/20 | launch+reset | `20261110T11210-sync-diagnostics-copy` | b4124c1e |
| 2026-11-10 11:28 | sync-diagnostics-copy | ❌ 15/20 | launch+reset | `20261110T11260-sync-diagnostics-copy` | b4124c1e |
| 2026-11-10 11:31 | sync-diagnostics-copy | ❌ 15/20 | launch+reset | `20261110T11291-sync-diagnostics-copy` | b4124c1e |
| 2026-11-10 11:34 | sync-diagnostics-copy | ❌ 15/20 | launch+reset | `20261110T11325-sync-diagnostics-copy` | b4124c1e |
| 2026-11-10 11:37 | sync-diagnostics-copy | ❌ 15/20 | launch+reset | `20261110T11353-sync-diagnostics-copy` | b4124c1e |
| 2026-11-10 11:41 | sync-diagnostics-copy | ❌ 15/20 | launch+reset | `20261110T11384-sync-diagnostics-copy` | b4124c1e |
| 2026-11-10 11:45 | sync-diagnostics-copy | ✅ 20/20 | launch+reset | `20261110T11443-sync-diagnostics-copy` | b4124c1e |
| 2026-11-10 11:58 | commontext-send-agent-block | ✅ 1/1 | launch+reset | `20261110T11581-commontext-send-agent-block` | 2aea7a7e |
| 2026-11-10 12:01 | commontext-send-agent-block | ❌ 9/12 | launch+reset | `20261110T11585-commontext-send-agent-block` | 2aea7a7e |
| 2026-11-10 12:06 | term-failure-copy | ⚠️ 0/0（无断言） | launch+reset | `20261110T12060-term-failure-copy` | 2aea7a7e |
| 2026-11-10 12:07 | term-failure-copy | ❌ 9/10 | launch+reset | `20261110T12070-term-failure-copy` | 2aea7a7e |
| 2026-11-10 12:07 | term-failure-copy | ❌ 9/10 | launch+reset | `20261110T12074-term-failure-copy` | 2aea7a7e |
| 2026-11-10 12:08 | term-failure-copy | ✅ 10/10 | launch+reset | `20261110T12080-term-failure-copy` | 2aea7a7e |
| 2026-11-10 12:08 | commontext-send-agent-block | ❌ 11/13 | launch+reset | `20261110T12054-commontext-send-agent-block` | 2aea7a7e |
| 2026-11-10 12:26 | commontext-send-agent-block | ❌ 0/3（fatal） | launch+reset | `20261110T12240-commontext-send-agent-block` | 3100c401 |
| 2026-11-10 12:33 | commontext-send-agent-block | ❌ 0/3（fatal） | launch+reset | `20261110T12305-commontext-send-agent-block` | 3100c401 |
| 2026-11-10 12:36 | commontext-send-agent-block | ✅ 14/14 | launch+reset | `20261110T12351-commontext-send-agent-block` | 3100c401 |
| 2026-11-10 12:42 | vcs-conflict-copy | ❌ 2/3 | launch+reset | `20261110T12410-vcs-conflict-copy` | 3100c401 |
| 2026-11-10 12:45 | vcs-conflict-copy | ❌ 1/3 | launch+reset | `20261110T12433-vcs-conflict-copy` | 3100c401 |
| 2026-11-10 12:48 | vcs-conflict-copy | ✅ 11/11 | launch+reset | `20261110T12463-vcs-conflict-copy` | 3100c401 |
| 2026-11-10 12:50 | vcs-conflict-copy | ✅ 11/11 | launch+reset | `20261110T12483-vcs-conflict-copy` | 3100c401 |
| 2026-11-10 12:52 | vcs-conflict-copy | ✅ 11/11 | launch+reset | `20261110T12502-vcs-conflict-copy` | 3100c401 |
| 2026-11-10 12:54 | vcs-conflict-copy | ✅ 11/11 | launch+reset | `20261110T12531-vcs-conflict-copy` | 3100c401 |
| 2026-11-10 12:57 | vcs-conflict-copy | ⚠️ 0/0（无断言） | launch+reset | `20261110T12562-vcs-conflict-copy` | 3100c401 |
| 2026-11-10 13:04 | vcs-conflict-copy | ✅ 11/11 | launch+reset | `20261110T13013-vcs-conflict-copy` | 2af9d894 |
| 2026-11-10 13:06 | vcs-conflict-copy | ⚠️ 0/0（无断言） | launch+reset | `20261110T13062-vcs-conflict-copy` | 2af9d894 |
| 2026-11-10 13:09 | vcs-conflict-copy | ✅ 11/11 | launch+reset | `20261110T13075-vcs-conflict-copy` | 2af9d894 |
| 2026-11-10 13:11 | vcs-conflict-copy | ✅ 17/17 | launch+reset | `20261110T13101-vcs-conflict-copy` | 25c85e6e |
| 2026-11-10 13:36 | waveconfig-json-error | ❌ 10/11 | launch+reset | `20261110T13325-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 13:39 | waveconfig-json-error | ❌ 10/11 | launch+reset | `20261110T13364-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 13:40 | agent-session-rail | ❌ fatal（未跑） | attach | `20261110T13402-agent-session-rail` | 5aeb6467 |
| 2026-11-10 13:41 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T13394-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 13:43 | agent-session-rail | ❌ 2/3 | attach | `20261110T13432-agent-session-rail` | 5aeb6467 |
| 2026-11-10 13:44 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T13415-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 13:46 | agent-session-rail | ❌ fatal（未跑） | attach | `20261110T13463-agent-session-rail` | 5aeb6467 |
| 2026-11-10 13:47 | agent-session-rail | ❌ fatal（未跑） | attach | `20261110T13472-agent-session-rail` | 5aeb6467 |
| 2026-11-10 13:49 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T13480-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 13:51 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T13500-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 13:55 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T13520-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 13:57 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T13553-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:00 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T13575-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:02 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T14005-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:05 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T14041-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:06 | agent-session-rail | ❌ 1/2（fatal） | launch+reset | `20261110T14042-agent-session-rail` | 5aeb6467 |
| 2026-11-10 14:08 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T14061-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:11 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T14094-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:14 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T14115-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:18 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T14154-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:21 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T14190-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:23 | agent-session-rail | ❌ 9/10 | launch+reset | `20261110T14201-agent-session-rail` | 5aeb6467 |
| 2026-11-10 14:25 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T14234-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:27 | agent-session-rail | ✅ 10/10 | launch+reset | `20261110T14253-agent-session-rail` | 5aeb6467 |
| 2026-11-10 14:29 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T14265-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:36 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T14330-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:38 | waveconfig-json-error | ✅ 1/1 | launch+reset | `20261110T14363-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:42 | waveconfig-json-error | ❌ 1/4 | launch+reset | `20261110T14394-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:45 | waveconfig-json-error | ❌ 10/11 | launch+reset | `20261110T14431-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:48 | waveconfig-json-error | ❌ 10/11 | launch+reset | `20261110T14460-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:52 | waveconfig-json-error | ❌ 10/11 | launch+reset | `20261110T14494-waveconfig-json-error` | 5aeb6467 |
| 2026-11-10 14:55 | waveconfig-json-error | ✅ 11/11 | launch+reset | `20261110T14523-waveconfig-json-error` | b60a6a7d |
| 2026-11-11 01:07 | commontext-send-agent-block | ❌ fatal（未跑） | launch+reset | `20261111T01001-commontext-send-agent-block` | 9f619450 |
| 2026-11-11 01:18 | commontext-send-agent-block | ❌ fatal（未跑） | launch+reset | `20261111T01124-commontext-send-agent-block` | 9f619450 |
| 2026-11-11 01:27 | commontext-send-agent-block | ❌ fatal（未跑） | launch+reset | `20261111T01201-commontext-send-agent-block` | 9f619450 |
| 2026-11-11 01:36 | commontext-send-agent-block | ❌ 3/3（fatal） | launch+reset | `20261111T01291-commontext-send-agent-block` | 9f619450 |
| 2026-11-11 01:48 | commontext-send-agent-block | ❌ fatal（未跑） | launch+reset | `20261111T01412-commontext-send-agent-block` | 9f619450 |
| 2026-11-11 01:53 | commontext-send-agent-block | ❌ 21/25 | attach | `20261111T01501-commontext-send-agent-block` | 9f619450 |
| 2026-11-11 01:55 | commontext-send-agent-block | ❌ 21/25 | attach | `20261111T01522-commontext-send-agent-block` | 9f619450 |
| 2026-11-11 02:02 | commontext-send-agent-block | ❌ 3/4（fatal） | attach | `20261111T02020-commontext-send-agent-block` | 9f619450 |
| 2026-11-11 02:05 | commontext-send-agent-block | ❌ 21/25 | attach | `20261111T02030-commontext-send-agent-block` | 9f619450 |
| 2026-11-11 02:08 | commontext-send-agent-block | ❌ 3/4（fatal） | attach | `20261111T02074-commontext-send-agent-block` | 9f619450 |
| 2026-11-11 02:18 | newtab-empty | ✅ 1/1 | launch+reset | `20261111T02184-newtab-empty` | 9f619450 |
| 2026-11-11 02:19 | newtab-empty | ❌ 1/3（fatal） | launch+reset | `20261111T02190-newtab-empty` | 9f619450 |
| 2026-11-11 02:29 | newtab-empty | ❌ fatal（未跑） | launch+reset | `20261111T02264-newtab-empty` | 9f619450 |
| 2026-11-11 02:35 | agent-property-scope | ❌ fatal（未跑） | launch+reset | `20261111T02283-agent-property-scope` | 9f619450 |
| 2026-11-11 02:38 | newtab-empty | ❌ fatal（未跑） | launch+reset | `20261111T02312-newtab-empty` | 9f619450 |
| 2026-11-11 02:42 | newtab-empty | ❌ fatal（未跑） | attach | `20261111T02412-newtab-empty` | 9f619450 |
| 2026-11-11 02:44 | agent-property-scope | ❌ fatal（未跑） | launch+reset | `20261111T02442-agent-property-scope` | 9f619450 |
| 2026-11-11 10:57 | agent-property-scope | — 未跑（用户要求不跑真机验证；判据由 vitest property/info-card + go test agentcontrol/agentdata 覆盖） | skipped | — | working-tree |
| 2026-11-12 00:55 | sync-diagnostics-copy | ⚠️ 0/0（无断言） | launch+reset | `20261112T00484-sync-diagnostics-copy` | 3128e846 |
| 2026-11-12 01:28 | sync-diagnostics-copy | ⚠️ 0/0（无断言） | launch+reset | `20261112T01212-sync-diagnostics-copy` | 3128e846 |
| 2026-11-13 14:36 | commontext-source-notion | ❌ fatal（未跑） | launch+reset | `20261113T14364-commontext-source-notion` | 4d4bcd3a |
| 2026-11-13 14:37 | commontext-source-notion | ❌ fatal（未跑） | launch+reset | `20261113T14294-commontext-source-notion` | 4d4bcd3a |
| 2026-11-13 14:43 | commontext-source-notion | ❌ fatal（未跑） | launch+reset | `20261113T14374-commontext-source-notion` | 3671f090 |
| 2026-11-13 14:56 | commontext-source-notion | ❌ fatal（未跑） | launch+reset | `20261113T14485-commontext-source-notion` | 3671f090 |
| 2026-11-13 15:04 | commontext-source-notion | ❌ fatal（未跑） | launch+reset | `20261113T14564-commontext-source-notion` | 3671f090 |
| 2026-11-13 15:09 | newtab-empty | ❌ fatal（未跑） | launch+reset | `20261113T15064-newtab-empty` | unknown |
| 2026-11-13 23:56 | commontext-editor-collapse（与 commontext-source-notion 同源断言） | ✅ 2/2（jsdom DOM 台；红证：旧源 2 failed → 新源 2 passed） | vitest jsdom | `frontend/app/commontext/commontext-compose-modal.dom.test.tsx` | working-tree |
| 2026-11-13 23:56 | commontext-source-notion（真机） | ⛔ 环境阻塞待补跑：Electron 启动器故障（连 newtab-empty 同故障：electron:dev exit 4/255、initPromise 120s 超时、CDP ECONNREFUSED），本机 5 次尝试全 fatal；行为断言由上一行 jsdom 台兜住 | skipped | `20261113T14364…14564` | 3671f090 |
| 2026-11-14 06:12 | tab-startup-restore | ✅ 1/1 | launch+reset+restart | `20261114T06120-tab-startup-restore` | 7a73cbd2a |
| 2026-11-14 06:17 | tab-startup-restore | ❌ fatal（未跑） | launch+reset+restart | `20261114T06103-tab-startup-restore` | 7a73cbd2a |
| 2026-11-14 06:34 | tab-startup-restore | ❌ 1/3（fatal） | launch+reset+restart | `20261114T06185-tab-startup-restore` | 7a73cbd2a |
| 2026-11-14 06:47 | tab-startup-restore（emain 恢复标记单测） | ✅ 4/4（红证：修复前 2 failed → 修复后 4 passed） | vitest | `emain/emain-window.test.ts` | working-tree |
| 2026-11-14 06:47 | tab-startup-restore（真机重启台） | ⛔ 环境阻塞待补跑：dev 实例 tabview init 实测 3~4 分钟（14:29→14:31），两次超启动器 420s 窗口后 fatal（06:17 / 06:34 行）；行为断言由上行单测兜住，重启真机验证待 G7 人工确认 | skipped | `20261114T0610*` | working-tree |
| 2026-11-14 07:05 | tab-drag-switch-fix（拖拽判定 / 乐观高亮 / 广播去重） | ✅ 21/21（红证：修复前 2 文件 ERR_MODULE_NOT_FOUND → 修复后 21 passed；tab 全套 102 passed） | vitest | `frontend/app/tab/tab-drag-model.test.ts` 等 | working-tree |
| 2026-11-14 07:02 | commontext-source-notion | ❌ fatal（未跑） | launch+reset | `20261114T07004-commontext-source-notion` | 874b5ec9f |
| 2026-11-14 07:05 | commontext-editor-draft（与 commontext-source-notion 同源断言） | ✅ 9/9（jsdom DOM 台 + 草稿模块单测 5 例；红证：旧源 5 failed → 新源 190 passed） | vitest jsdom | `frontend/app/commontext/commontext-compose-modal.dom.test.tsx` + `commontext-editor-draft.test.ts` | 874b5ec9f |
| 2026-11-14 07:05 | commontext-source-notion（真机） | ⛔ 环境阻塞待补跑：Electron 启动器故障依旧（launcher exit=201，与 2026-11-13 5 连 fatal 同病）；真机台已补 editor-draft-persisted/cleared 断言，启动器修复后补跑 | skipped | `20261114T07004-commontext-source-notion` | 874b5ec9f |
