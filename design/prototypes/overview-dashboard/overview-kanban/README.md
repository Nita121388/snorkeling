# Overview 看板原型（优化方案）

目标：将当前“按 Tab 列表分组”的 Overview，从列表式布局改造成更像看板（Kanban）的形态。

参考灵感：
- Linear：极简卡片、清晰状态、信息密度适中、聚焦当前在做的事
- Jira：按状态/泳道组织，便于横向扫视整体进展
- ClickUp：紧凑卡片、快速操作、适合多任务并行场景

## 原型清单
- A. `prototype-a-tab-columns.html` —— **Tab 列（最保守）**：每个 Workspace Tab 作为一列，沿用现有分组思路但改成横向看板列
- B. `prototype-b-status-columns.html` —— **状态列（最符合看板本质）**：按 Agent 状态（Running / Waiting for input / Needs attention / Done / Idle）划分列，跨 Tab 聚合
- C. `prototype-c-hybrid-lane.html` —— **混合泳道（最平衡）**：顶部按 Tab 分泳道（Lane），泳道内按状态自动归类卡片，兼顾“归属”（Tab）和“进展”（状态）
- D. `prototype-d-linear-board.html` —— **Linear 风格（最现代）**：极简卡片、弱分组、强调状态徽标 + 消息预览 + 备注，信息层级更清晰

## 使用方式
直接用浏览器打开 `index.html` 即可在同一页对比四套方案。
