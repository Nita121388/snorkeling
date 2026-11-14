# PRD: CommonText 折叠摘要标签样式与展开态统一（chip）

## Goal

属性折叠摘要行的 tags 项从 join 纯文本（`urgent · work`）改为与展开态**同一个 chip 组件**（`SessionTagChips`），折叠/展开两态样式、尺寸一致。

## 背景

上一轮把折叠摘要 tags 改为标签名 join 文本，功能对但样式与展开态的 chip 不统一，用户反馈不好看。展开态 Tags 行与列表行/筛选行都用 `SessionTagChips`（border 胶囊、`text-[11px] leading-none px-2 py-0.5`）。

## 方案

- 摘要 map 里 tags 项特判：有标签时渲染 `<SessionTagChips tags={detailTags} selectedTags={detailTags} />`（空态仍给 `0` 文本占位），icon/tooltip 保持；tags 容器允许收缩 + `flex-wrap`（标签多时换行而不是把 creator/computer 等挤出视口）。
- `detailPropertySummary` 的 tags `text` 回退为 `detailTags.length === 0 ? "0" : ""`（渲染层接管 chips）。

## 验收标准（数字可判）

1. `npx vitest run frontend/app/commontext/` 全绿；dom 台新增：折叠摘要 tags 项内含 chip 按钮（`[data-commontext-properties-summary="tags"] button`），且文本含标签名、不含 `#`
2. 红证：旧源（join 文本渲染）跑该断言 → failed（无 chip button）
3. 真机台断言不变（`tags-summary-shows-names` 走 textContent，chip 渲染同样通过）

## 工时

微小任务：单文件渲染分支 + 1 断言。
