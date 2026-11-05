# LESSONS — 教训库索引

> 一条教训 = 索引一行 + 正文写进 `.trellis/spec/`（带 `paths:` 前缀，下次碰到同样文件自动注入）。
> 只写索引不写 spec = 没人会看见；只写 spec 不写索引 = 无法审计谁在复用。
> 写入用 `queue.mjs lesson add`，它会同时校验 spec 存在与 paths 前缀。

### L-0001 prd_hash 必须锚 ## Goal，否则签字动作自毁 hash
- key: park:gate-reopen
- 触发: 给任何门加 hash 冻结时
- 规范: `.trellis/spec/guides/day-night-loop-contract.md`
- 入库: 2026-11-05
- 引用: 0

### L-0002 解析失败不能静默返回空，必须回退 last-good 快照
- key: park:out-of-scope
- 触发: 任何读队列/规则文件的入口
- 规范: `.trellis/spec/guides/day-night-loop-contract.md`
- 入库: 2026-11-05
- 引用: 0
