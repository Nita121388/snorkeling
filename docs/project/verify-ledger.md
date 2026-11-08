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
| 2026-11-08 | acs-p02（新 area，非 verify 台） | ◑ 7 过 / 1 环境阻塞（AC7 FE 渲染：renderer 恒 hidden） | CDP RpcApi + go test | `verify-runs/2026-11-08-acs-p02.md` | ebab6998 |
