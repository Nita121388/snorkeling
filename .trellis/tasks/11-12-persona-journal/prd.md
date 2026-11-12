# A6 journal 写入器 + 提议制记忆 + 蒸馏

## Goal

让人设「记得住」：当班自动留痕、教训提议入档、记忆过厚可蒸馏。

## Requirements

- journal 写入器：当班结束（或 supervisor 轮次）写 `<id>/.persona/MEMORY/journal.md`（时间戳 + 状态 + 一句摘要）；机器区，agent 直写
- 提议制：`MEMORY/inbox.md` 条目（kind: facts|lessons|charter + 正文 + 来源会话）；批准 → 追加目标文件 + journal 记录；驳回 → 标记 dismissed 保留
- 蒸馏：lessons/facts 超阈值 → 后台合并去重（复用 AutoGenerate RPC + gen worker），diff 可查看、可回滚
- 渐进披露对齐：facts 头部 `## TL;DR` ≤ 5 条由蒸馏维护

## Acceptance Criteria

- [ ] `go test ./pkg/persona/...` → ok（inbox 解析/批准/蒸馏触发）
- [ ] 一次登场结束 → journal 新增 1 行且匹配时间戳格式
- [ ] 批准后目标文件含该条且 inbox 状态 approved（跨文件一致性）
- [ ] 超阈值触发蒸馏：条目数下降且无丢失（覆盖率 100%）

## 依赖

A3（当班生命周期）；A1。
