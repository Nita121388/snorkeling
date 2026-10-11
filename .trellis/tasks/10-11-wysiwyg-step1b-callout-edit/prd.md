# callout 块身份 + 原地 WYSIWYG 编辑（挂起）

父任务：`10-11-wysiwyg-overhaul`

## 状态：挂起（blocked-by 未知触发条件）

本任务原本是 `10-11-wysiwyg-step1-stopgap` 的 D3/D4，已实现并通过单元测试，
但在**真实应用**验证时造成了数据损坏，因此撤出（代码已回退，见 step1 的范围变更记录）。

## 需求（撤出前的实现，可作为下一次的起点）

- **R1 块身份**：`remarkCalloutAlert` 产出的包装节点改用自定义标签 `<calloutalert>`
  （沿用项目里 `waveblock` / `mermaidblock` 的惯例），并在插件里保留 `position: node.position`，
  使 `renderer-registry` 注册的渲染器能通过 `srcLineAttrs` 注入
  `data-source-line` / `data-source-line-end`；sanitize schema 需同时放行该 tag 与 class。
- **R2 点击进入编辑**：`resolveEditTargetFromElement` 最前面识别 `.markdown-alert[data-source-line]`，
  整块解析为 `blockKind: "quote"`。
- **R3 干净的种子**：种子只含「标题文本 span 的 innerHTML」+ 正文段落，**不得包含 emoji `<button>`**
  （`<button>` 走序列化 default 分支会被 unwrap，emoji 文本会泄漏进正文）。
- **R4 标记保真**：从源码首行捕获 `[!TYPE]` + emoji 的原文（保大小写），提交时回写到序列化首行；
  普通引用块（无标记）不得凭空新增 `[!quote]`。

## 前置条件（必须先完成，否则不得合入）

1. **复现并解释触发条件**：真实应用里曾出现「编辑器根为空 → 序列化出 `>` 空壳 → 提交覆盖整段引用」。
   单元测试里种子与序列化往返完全正常（`<p>text</p>` → `> text` → 回写前缀），
   所以空根是**运行时行为**（怀疑与合成点击/窗口未激活导致 blur、焦点被抢、会话异常关闭有关）。
   在解释清楚并消除该路径之前，不得重新启用 callout 的 WYSIWYG 编辑。
2. **在一次性草稿文件上验证**：不再在真实笔记上做点击验证；需准备可随意写坏的临时 md
   （含：单行 callout、多段 callout（`>` 空行分隔）、软换行 callout、无标记普通引用、含 emoji 的 callout），
   逐个验证「进入编辑 → 不改 → 失焦」不写盘、「进入编辑 → 改标题/正文 → 失焦」往返正确。
3. 保留并复用已合入 step1 的守卫 `isEmptyQuoteShellDraft()`（空壳草稿不得覆盖非空引用）。

## 验收标准

- [ ] 能给出空编辑器根复现路径（或证明该路径已被消除）并记录在案
- [ ] 在临时草稿文件上完成上面的 5 类场景往返验证，且**零非预期写盘**
- [ ] `data-source-line` / `-end` 正确注入包装节点；sanitize 未剥离 tag/class
- [ ] 提交后 `[!TYPE]` 大小写、emoji、`>` 前缀、段间 `>` 空行全部保真
- [ ] 普通引用块提交后不新增 `[!quote]`
- [ ] `npx vitest run frontend/app/element` 全绿；`npx tsc --noEmit` 无新增错误

## 已知风险

- 该路径**有写盘能力**，任何"看起来能用"的验证都不足以替代「不写盘的证明」
- 数据损坏无恢复手段（除 git），因此宁可挂起
