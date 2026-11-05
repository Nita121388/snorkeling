# 真机验证台账

> 由 `scripts/verify/lib/report.mjs` 自动追加，**不要手改历史行**。
> 明细与截图在 `verify-runs/<ts>-<area>/`（gitignore），这里只留结论。
> 查看索引：`node scripts/verify/index.mjs`

| 时间 | area | 结论 | 模式 | 证据目录 | commit |
| --- | --- | --- | --- | --- | --- |
| 2026-11-05 05:44 | agent-card-seen | ✅ 21/21 | launch+reset | `20261105T05392-agent-card-seen` | 7cc74a30 |
| 2026-11-05 06:47 | agent-card-seen | ✅ 21/21 | launch+reset | `20261105T06423-agent-card-seen` | 04ac4722 |
| 2026-11-05 06:53 | preview-edit | ✅ 5/5 | --expect=fixed / rpc | `20261105-145318` | working-tree |
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
