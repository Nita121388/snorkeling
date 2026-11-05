# 真机验证台账

> 由 `scripts/verify/lib/report.mjs` 自动追加，**不要手改历史行**。
> 明细与截图在 `verify-runs/<ts>-<area>/`（gitignore），这里只留结论。
> 查看索引：`node scripts/verify/index.mjs`

| 时间 | area | 结论 | 模式 | 证据目录 | commit |
| --- | --- | --- | --- | --- | --- |
| 2026-11-05 05:44 | agent-card-seen | ✅ 21/21 | launch+reset | `20261105T05392-agent-card-seen` | 7cc74a30 |
| 2026-11-05 06:47 | agent-card-seen | ✅ 21/21 | launch+reset | `20261105T06423-agent-card-seen` | 04ac4722 |
| 2026-11-05 06:53 | preview-edit | ✅ 5/5 | --expect=fixed / rpc | `20261105-145318` | working-tree |
| 2026-11-05 11:55 | commontext-meta-sort | ✅ 21/21 | launch+reset | `20261105T11533-commontext-meta-sort` | 63fa01a5 |
