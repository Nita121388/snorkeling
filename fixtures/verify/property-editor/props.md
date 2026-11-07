---
title: 属性卡 fixture
tags:
  - fix
  - ui
status: draft
owner: nita
---

# VERIFY-FIXTURE-v1-a7f3

`property-editor` 验证台专用 fixture：给 md 预览属性卡提供 `tags` / `list` 型多值属性。

**不要改文件名或首行哨兵**：`scripts/verify/lib/open.mjs` 用哨兵确认"打开的确实是这个文件"。

- 上面 frontmatter 的 `tags` 是 list（YAML block sequence），渲染成多值 chips。
- 点击属性值 → 应该出现 Wolai 风格浮层（已选 chips + 搜索 + 候选 + 创建）。
