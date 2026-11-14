# PRD: CommonText 标签 chip 去 # 前缀（兼容历史数据）+ 折叠摘要展示标签名

## Goal

1. 标签 chip 不再显示 `#` 前缀（只显示标签名），**兼容历史数据**：旧 `item.tags` 里存了 `#tag` / `tag#` 的条目读出来即净，不出现 `#tag` chip。
2. 详情的属性折叠摘要行**展示标签名**（不再只显示数量），折叠态也能直接看到有哪些标签。

## 背景（代码事实）

- chip 渲染层 `SessionTagChips` 只渲染 `tag` 原文（无 `#`），但 title 提示是 `#tag`；
- 历史数据里 `item.tags` 可能含 `#`：`normalizeCommonTextTags`（commontext-model.ts:117）只做 trim + 去重，**不剥 `#`**——列表行 chips、左侧标签筛选 chips、tag 汇总（`getCommonTextTagSummaries`）都直接吃它；
- 读路径 `normalizeCommonTextItem`（:152）→ `normalizeCommonTextTags(raw.tags)`，写入路径 `upsertCommonTextItem` 也走同一函数：在它内部剥 `#` 即同时覆盖「历史读数据」与「新写入」；正文 `#tag` 字面（`extractSessionTagsFromNote`）本就无 `#`，不受影响；
- 折叠摘要（`detailPropertySummary`）当前 tags 项只渲染数量（`String(detailTags.length)`）。

## 方案

1. `normalizeCommonTextTags`：`rawTag.trim()` 后补 `replace(/^#+/,"").replace(/#+$/,"")`（与 `normalizeSessionTag` 同口径）。空串/去重逻辑不变。
2. `detailPropertySummary` 的 tags 项：`text = detailTags.length > 0 ? detailTags.join(" · ") : "0"`；tooltip 列出全部标签名。摘要 span 允许收缩（tags 项去掉 `shrink-0`），内层 `truncate` 防溢出。
3. 不改：正文 `#tag` 编辑语义、浮层编辑器、tag 筛选逻辑。

## 验收标准（数字可判）

1. `npx vitest run frontend/app/commontext/` 全绿，新增：
   - `normalizeCommonTextTags(["#urgent","work#"," #legacy "])` → `["urgent","work","legacy"]`；`"#a,#b"` 字符串输入同样干净
   - dom 台：seed 条目 `tags: ["#legacy"]` → 列表行/筛选 chip 文本不含 `#`
   - dom 台：加 tag 后折叠属性 → 摘要 tags 项包含标签名（不是纯数字）
2. 红证：旧源跑新断言 → ≥1 failed
3. 真机台（若可用）：补 `tags-summary-shows-names` 断言；启动器故障则 skipped

## 工时

小任务：commontext-model.ts 一行语义 + 摘要渲染 + 测试。
