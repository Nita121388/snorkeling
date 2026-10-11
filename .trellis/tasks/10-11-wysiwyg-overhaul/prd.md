# WYSIWYG 彻底改造：块身份、列表载体与逐类型覆盖

## Goal

让段落 / 标题 / 列表 / 引用 / callout 五类块具备**干净的原地编辑**（不裁剪、不漂移、不丢块身份），
并为「结构操作（L3）」与「逐类型覆盖（L4/L5）」打好地基。

方案全文（含思源源码对照、类型覆盖矩阵、差距清单）：
`Obsidian: My Projects/Snorkling/方案/Block-Editor 笔记编辑体验升级/07-彻底改造-对标思源-块身份与逐类型覆盖.md`

## 背景（实测根因）

| 现象 | 根因 |
|---|---|
| callout 点击无法进入编辑 | `remarkCalloutAlert` 把 blockquote 的 `hName` 改成 `div`，注入 `data-source-line` 的渲染器只注册在 `blockquote` key → div 无身份 → `closest("[data-source-line]")` 为 null |
| 列表编辑「位置偏移」 | 点击命中最近的 `<li>`（UL 与 LI 都带 `data-source-line`）→ 编辑种子是裸 `<li>`（无 `<ul>`，非法 HTML）→ 盒子与渲染态不同 |
| 列表编辑「显示不全」 | overlay `height = targetRect.height` + `overflow:hidden` + `contain:layout paint` → 内容变高即被裁且不可达 |

架构性根因：**渲染 DOM 与编辑 DOM 是两个结构，靠行号范围关联，没有不变式**。

## 任务地图

| 子任务 | 内容 | 依赖 | 交付 |
|---|---|---|---|
| `10-11-wysiwyg-step1-stopgap` | 列表命中 UL/OL；overlay 高度可增长；清理 `node="[object Object]"`；**数据丢失守卫**（空壳草稿不得写盘） | 无 | 用户当下 3 个现象消失 + 数据安全闭合 |
| `10-11-wysiwyg-step1b-callout-edit` | callout 块身份 + 原地 WYSIWYG 编辑（**挂起**） | 需先复现并消除「编辑器根为空却提交空壳」的运行时路径，并在一次性草稿文件上验证 | callout 可点即编、标记/emoji 保真 |
| `10-11-wysiwyg-step2-list-div` | 列表改 div 块载体 + caret 锚定（`<wbr>` 等价物） | 依赖 step1 | 浏览器规范化与光标漂移根除 |
| `10-11-wysiwyg-step3-block-identity` | `data-block-id` 取代行号作身份；块级提交 + 逆操作缓存 | 依赖 step1、step2 | 漂移/丢数据/undo 整类问题根除 |

阶段 4（结构操作）与阶段 5（逐类型覆盖）在本父任务完成后按覆盖矩阵另建子任务。

## 跨子任务验收标准（父任务口径）

- [ ] 段落 / 标题 / 引用：点击任意位置 → 原地编辑，无偏移、无裁剪
- [ ] 列表：点击任意项 → 编辑整表（或项），**首屏即完整可见**，不出现单个裸 `<li>`
- [ ] 列表：编辑后提交 → 行数变化不丢项、不错位（含新增项、换行、嵌套）
- [ ] callout：点击 → 原地编辑，**不显示源码标记**（`[!NOTE]` / `>` 不可见），提交后 `[!TYPE]` 与 emoji 保留
- [ ] 全部块渲染 DOM 无 `node="[object Object]"` 等 React 内部属性泄漏
- [ ] `npx vitest run frontend/app/element` 全绿；`npx tsc --noEmit` 无新增错误
- [ ] 每个子任务独立可验收、独立 commit

## 明确不做

- 全盘移植思源范式（≈重写 markdown⇄块树 + 事务系统 + caret 几何；仅思源 `protyle/wysiwyg/` 就约 2MB TS + Go 的 Lute）
- 阶段 4/5 的具体类型实现（表格行列操作、数学/脚注/定义列表渲染、mermaid 对话框等）
- 改变 markdown 作为持久化格式（`.sy` 式块树存储不在范围内）

## 事故与范围变更（2026-10-11）

step1 原含 callout 原地编辑（D3/D4），实现后**在真实笔记上造成数据损坏**（引用块正文被覆盖为 `>`，已 git 恢复），
故全部回退，改为：

- step1 只上「列表整表编辑 + overlay 可增长 + 属性清洁 + 数据丢失守卫」，并闭合 check 发现的 2 个 BLOCKER
- callout 编辑移入 `10-11-wysiwyg-step1b-callout-edit`（挂起，带前置条件）

教训：**编辑器写盘路径必须以「用户是否真的编辑过」为准，而非「序列化结果 ≠ 原文」**；
真实文件上做交互验证前，必须先确认最小写盘风险（或改用一次性草稿文件）。

## 风险与回滚

- 风险集中在 step2（列表载体更换）与 step3（提交模型更换），两者都涉及面广
- 缓解：保持双轨（新路径默认 flag 关闭）、每步独立 commit + archive、每步都有回归测试
- 回滚点：每个子任务一个 commit；父任务不聚合提交
