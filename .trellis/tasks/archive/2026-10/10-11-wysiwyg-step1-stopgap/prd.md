# 止血：列表偏移/裁剪 + callout 身份与原地编辑 + 属性污染清理

父任务：`10-11-wysiwyg-overhaul`（见其 `prd.md` 的跨子验收标准）

## 背景（实测根因）

### 问题 1：列表编辑「位置偏移 / 显示不全」

- `frontend/app/element/markdown.tsx` 的 `resolveEditTargetFromEl`：`UL` 和 `LI` **都**带 `data-source-line`，
  `closest("[data-source-line]")` 命中最近的 `LI` → `target` = 单个 `<li>`
- `frontend/app/element/markdown-inline-edit.tsx` 的 `captureWysiwygInfo`：`blockKind === "list"` 时
  `html = targetEl.outerHTML` → 编辑种子是**裸 `<li>`**（无 `<ul>` 包裹 → 非法 HTML → 盒子与渲染态不同 → 偏移）
- `markdown-inline-edit.tsx` 的 `measureOverlay`：`height: targetRect.height`；`markdown.scss` 的
  `.inline-edit-overlay { overflow: hidden; contain: layout paint; }` → 内容变高即被裁且不可达 → 显示不全
- CDP 实测：编辑态 `div.wysiwyg-editor` 只有 1 个子元素（`LI`），overlay `height:21px`，
  而渲染态列表实际需要 69px

### 问题 2：callout 点击无法进入编辑

- `frontend/app/element/remark/callout-alert.ts` 把 blockquote 的 `hName` 改成 `div`，
  而注入 `data-source-line` 的渲染器只注册在 `blockquote` key 上
  （`frontend/app/element/markdown-render/renderer-registry.tsx:258`）
- → `div.markdown-alert` 无 `data-source-line` → `closest(...)` 返回 null → 编辑器不打开
- 即使能打开，`captureWysiwygInfo` 对 callout 也不可用（种子会混入 emoji `<button>`，
  序列化时 `<button>` 走 default 分支 unwrap → emoji 文本泄漏进正文）

### 问题 3：渲染 DOM 泄漏 React 内部属性

- 各渲染器写 `<li {...props} {...srcLineAttrs(props)} />`，`{...props}` 含 react-markdown 的 `node` 对象
  → 实测渲染出 `node="[object Object]"`
- 该属性还会被克隆进编辑态

## 需求

- **R1 列表命中**：点击任意列表项，编辑目标提升为所属 `UL`/`OL`；编辑种子是**完整列表**的
  `outerHTML`（结构合法）；编辑行范围覆盖整表；不再产生裸 `<li>` 种子
- **R2 overlay 高度可增长**：编辑内容超出目标矩形时必须**完整可见**（不裁剪）；同时不溢出可视区
  （超出可视区时内部滚动）
- **R3 callout 块身份**：`.markdown-alert` 携带 `data-source-line` / `data-source-line-end`；
  点击其内部任意位置可进入编辑（不再要求是 `blockquote` 标签）
- **R4 callout 原地 WYSIWYG**：编辑态**不出现**源码标记（`[!TYPE]`、`>` 前缀不可见）；
  标题行与正文都可编辑；提交后 `[!TYPE]`（保留原大小写）、emoji、`>` 前缀正确回写，正文内容不变
- **R5 属性清洁**：渲染 DOM 不出现 `node`（或任何 React 内部对象）属性；编辑态种子同样干净

## 验收标准

- [ ] 点击列表项 → 编辑态 DOM 为 `div.wysiwyg-editor > ul > li×N`（不是裸 `li`）；overlay 高度 ≥ 列表实际高度
- [ ] 在列表编辑中按 Enter 新增项 / 内容换行 → 内容**完整可见**，不被裁剪
- [ ] 列表编辑提交后：项数正确、顺序正确、无丢行（含嵌套列表场景不破坏结构）
- [ ] 点击 callout（或普通引用块）任意位置 → 进入原地编辑；屏幕上无 `[!quote]` / `[!NOTE]` / `>` 可见
- [ ] callout 提交后：首行 `[!TYPE]` 与 emoji 原样保留（大小写不变），正文行前缀为 `>`，内容与编辑一致
- [ ] 普通引用块（无 `[!TYPE]`）提交后**不新增** `[!quote]` 标记
- [ ] 渲染 DOM 中不存在 `node="[object Object]"`（可用脚本/测试断言）
- [ ] `npx vitest run frontend/app/element` 全绿；`npx tsc --noEmit` 无新增错误（基线 68）
- [ ] 新增测试覆盖：列表种子为完整列表；callout 编辑提交保留标记与 emoji；属性清洁

## 明确不做

- 列表 div 块化（→ step2）
- 块身份 / 块级提交（→ step3）
- callout 类型切换 UI、emoji 选择面板、标题/正文拆分渲染（后续阶段）
- 表格 / 代码块 / 图片等的编辑改动
- 不改 markdown 持久化格式

## 风险

- R2 涉及 overlay 定位/尺寸机制，可能影响 textarea / 代码块编辑器路径 → 必须回归全部块类型
- R3/R4 涉及 remark 插件输出结构 → 必须回归所有 callout/引用块渲染
- 缓解：改动逐项独立 commit；每项先补测试再改

---

## 范围变更记录（2026-10-11，事故后决定）

### 撤出：R3 / R4（callout 块身份与原地编辑）

原计划的 D3（callout 块身份）与 D4（callout 原地 WYSIWYG）**已实现并通过单元测试**，
但在真实应用验证时造成数据损坏，故全部回退，另立 `10-11-wysiwyg-step1b-callout-edit`（挂起）。

**事故经过**：CDP 交互验证期间，`LiCASmart-Leak-Investigation` 仓库的两个真实笔记
（`tools/实验-2026-09/软件实验室连续测试数据-0918/00-速览.md`、`AGENTS.md`）
的引用块正文被覆盖为单个 `>`。已用 `git checkout --` 完整恢复并核对。

**破坏路径**：WYSIWYG 提交取自 DOM 序列化（`wysiwygRef.getMarkdown()`），
而**空的编辑器根**序列化出来正是该块类型的空壳（引用块 = `">"`）；
它与 `initialContent` 不相等 → 被判定为「用户已修改」→ 整段引用被写成 `">"`。
（此前为正确比对 `[!TYPE]` 前缀，callout 的 no-op 判定被改为比较 `committedDraft`，
失去了 `draftText === initialContent` 原本对「未落种子会话」的保护。）

**未查明**：编辑器根为何为空。种子与序列化的往返在单元测试里完全正常，
因此空根是运行时行为（疑与合成点击、窗口未激活导致 blur、焦点被抢、会话异常关闭有关），
**未复现出触发条件**。

### 保留：数据丢失守卫（本任务的四号交付，替代原 D3/D4）

- `isEmptyQuoteShellDraft()`：引用块序列化出的「只有裸 `>`」草稿，在原文非空时一律视为 no-op，绝不写盘
- 恢复 no-op 判定的 original 语义 `draftText === initialContent`（未落种子/未编辑的会话不改文件）
- 顺带修复两个同族保真缺陷（本次一并合入，均有测试）：
  - 多段引用提交时丢失 `>` 空行分隔 → 回解析后正文并进标题行（内容变化）
  - 松散列表的 `\n` 文本节点在编辑态 `pre-wrap` 下各占一整行 → 列表进编辑双倍行距

### 验收标准修订

- [x] 列表点击 → 编辑态为完整 `<ul>`（实测：3 项全在，高度 69px 与渲染态一致，项间距 24px）
- [x] overlay 不裁剪：min-height = 块高度，内容变高时自动增长（实测 69 → 86），并带 max() 下限
- [x] 渲染 DOM 无 `node` 属性（实测 3 → 0；全页无 `[object Object]`）
- [x] 空壳草稿不覆盖非空引用（单测覆盖）
- [x] 44 文件 / 597 测试全绿；tsc 68（基线不变）
- [~] R3/R4（callout 编辑）→ 移出本任务，见 `10-11-wysiwyg-step1b-callout-edit`
