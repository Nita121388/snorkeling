# note：text 语义已变（tags 结构化权威 + 读路径惰性迁移）

来源：`11-14-commontext-tags-structured`（2026-11-14）。

- `item.tags: string[]` 现在是**结构化唯一权威**；`item.text` 只存内容，不再包含 `#tag` 字面。
- 读路径 `normalizeCommonTextItem` 做惰性迁移：`tags = item.tags ∪ extract(text)`、`text = stripSessionTagHashes(text)`（剥完为空则回退原文）。所有消费面（含同步比较）都过这条读路径，同版本两台机器一致。
- **跨机混合版本风险**：对端仍是旧版本时，其 `text` 仍含 `#tag` 字面而本地是干净文本 → 同一 `id` 可能出现一次内容冲突（两边都认为对方「改过正文」）。建议同步比较时对 `text` 先过 `normalizeCommonTextItem` 的同一迁移（或等两端都升级后再首次同步）。
- `rev/deletedat/origin` 等字段形状未变，无需迁移；墓碑条目同样走 normalize。
