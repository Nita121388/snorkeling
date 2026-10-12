# 子任务 1：零差异地基与门禁（parity-harness）

## Goal
把「编辑态 ≡ 预览态」从**愿望**变成**机制 + 可执行门禁**。这是后续所有块类型的前置地基：不先做，每加一类块都会先产生样式差异再回头补（复利返工）。

## 关键事实（来自 08 方案 §3 与调研）
- **Wolai 的做法**：没有预览态，contenteditable 常驻，聚焦**不改变任何结构性样式**，唯一 delta 是 hover 高亮（[W1] §4）
- **我们的现状**：`clone-then-restyle` + `.inline-edit-overlay[data-block-kind=...]` 作用域 CSS —— **差异的根源就是这套覆盖声明**
- 已知失效案例：`span.markdown-alert-title-text` 的 className 被 sanitize 静默剥掉 → CSS 从未生效（10-08 修复其实没生效）
- 已知悬空 token：`--wolai-*` 全仓引用但**未定义**

## Requirements
- R1 **同源渲染器**：编辑态与预览态必须由同一渲染器组件产出（禁止「预览一套、编辑一套 DOM」）
- R2 **同构种子**：种子 DOM 与预览 DOM 结构一致（除 caret 锚点 `<wbr>` 等必要标记）；交付**种子结构同构测试**
- R3 **overlay 样式契约**：`data-block-kind` 作用域 CSS 只允许声明**非结构性**属性（caret/selection/hover 可供性）；交付**scss 白名单契约测试**（零依赖扫描）
- R4 **CDP parity 脚本**：复用 `scripts/inspect-electron-ui.mjs`，对同一块在「预览态 / 编辑态」抓取 computed style 关键属性并逐项比对，输出差异表
- R5 **悬空 token 修复**：修 `--wolai-*`（暗色引用块对比度不足），并加**token 存在性校验**（引用的 token 必须有定义）

## Acceptance Criteria
- [ ] 契约测试：overlay 作用域 CSS 出现结构性属性（padding/border/background/font-*/margin/line-height/min-height）即失败
- [ ] 同构测试：对代表性块（p/h1-h6/list/quote/callout/code/table）断言「预览 DOM ≡ 编辑种子 DOM」结构与 class 序列一致
- [ ] CDP parity 脚本可跑：对隔离沙箱中的块输出差异表，差异为 0（hover/caret 除外，明确列出豁免项）
- [ ] token 校验测试：`var(--x)` 无定义即失败；`--wolai-*` 悬空问题消除（视觉对比度经沙箱截图确认）
- [ ] 现有 748 用例全绿、tsc 68、无行为变化

## 不做
- 不改成「预览元素直接变 contentEditable」（方案 A3，终态但要重写核心链路）
- 不动主题色与配色体系（只修悬空 token 的**定义缺失**，不新增颜色值以外的设计变更）
