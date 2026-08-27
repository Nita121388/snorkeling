# 保存状态优化 — Tab 脏点 + 冲突弹窗

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/block/block.tsx, frontend/app/block/block.scss, frontend/app/modals/unsavedfilemodal.tsx, frontend/app/modals/modal.tsx, frontend/app/modals/modal.scss, frontend/app/element/button.scss
> 最后同步：2026-08-20
> 对应方案：`Primary Mission/60-项目/Snorkeling/Snorkeling-打开md预览与保存状态优化方案.md`

## 需求

1. 多个 block 被 Tab 化为一组时，inactive tab 标签上应显示未保存修改的绿色圆点（脏点），让用户在不切到对应 tab 的情况下也能看出哪些文件有待保存的修改。
2. 保存文件时，若磁盘内容已被外部（AI Agent）修改，弹出冲突选择框：覆盖保存 / 放弃修改 / 复制差异交给 Agent / 取消。
3. 冲突时支持一键复制格式化的差异文本到剪贴板，用户可直接粘贴给 Agent 让其合并。

## 原型内容

页面分两个独立演示区（均含交互），覆盖全部三个新增界面：

| 区域 | 演示内容 |
| --- | --- |
| ① Tab 脏点 | 三个 md tab 组（`note-a.md`/`note-b.md`/`agent.md`），点击「编辑 note-b.md」→ 第二个 tab 出现绿点，「保存」→ 绿点消失；展示脏点与 Agent 状态点共存 |
| ② 冲突弹窗 | 模拟前置状态（base/mine/theirs 三版本内容卡片），点「模拟保存」→ 弹出冲突弹窗；点「复制差异」→ 弹窗关闭，下方显示剪贴板内容预览；ESC 关闭弹窗 |

## 结构镜像对照

| 原型元素 | 镜像真实源 | 说明 |
| --- | --- | --- |
| `.inline-tab-block` / `.inline-tab-block-tabs` | `frontend/app/block/block.tsx` InlineTabBlock + InlineTabBlock ~L563 | tabs 条 > group-handle + tab N个 + active 内容区 |
| `.inline-tab-block-tab` / `.inline-tab-block-tab-main` | `frontend/app/block/block.tsx` InlineTabLabel ~L390 | tab 标签：icon + span + statusdot + lockicon + close |
| **新增** `.inline-tab-block-tab-dirty-dot` | `preview-dirty-state.ts`（新建）`getBlockDirtyAtom()` | 基于 `PreviewSharedDraftRecord.draftContent` 的 derived atom |
| `.agent-brand-icon` + `.inline-tab-block-tab-statusdot.is-done` | `frontend/app/block/block.tsx` InlineTabLabel ~L240 | 展示脏点与 agent 状态点的共存场景 |
| `.modal-wrapper` / `.modal-backdrop` / `.modal` | `frontend/app/modals/modal.tsx` FlexiModal + `modal.scss` | 固定定位全屏 wrapper + 半透明 backdrop + 居中 modal |
| `.conflict-body` (`.conflict-title` + `.conflict-desc` + `.conflict-summary`) | `frontend/app/modals/unsavedfilemodal.tsx` | 标题 + 文件说明 + 三版本摘要行（颜色区分） |
| `.modal-footer .wave-button` | `frontend/app/element/button.scss` `.wave-button.solid.green` / `.ghost.red` / `.ghost.grey` / `.outlined.green` | 按钮语义：放红、取消灰、复制绿 outline、覆盖绿 solid |
| 复制差异输出（`.copy-output`） | `frontend/app/view/preview/conflict-copy.ts`（新建）`buildConflictCopyText()` | 原型内 JS 简化生成，真实用 jsdiff `createTwoFilesPatch` |

## 交互

1. 场景一：点击「编辑 note-b.md」→ tab 2 标签出现绿色圆点（模拟 `newFileContent` 非空）；点击「保存」→ 圆点消失（模拟 `draftContent` 归零）。
2. 场景二：点击「模拟保存」→ 弹出冲突弹窗；弹窗内「复制差异」→ 弹窗关闭，下方展开剪贴板内容预览（模拟 `conflict-copy.ts` 的输出格式）。
3. 弹窗任意点背景或按 ESC → 关闭弹窗；「放弃修改」→ 关闭并模拟脏点消失（重载磁盘）。

## 复制差异输出格式（Part C `conflict-copy.ts`）

```
文件冲突: notes/note-b.md
该文件在你编辑期间被外部修改（可能是 AI Agent），你的未保存修改与磁盘当前内容冲突。

---

== 你的未保存修改 (base → 你的草稿) ==

--- a/notes/note-b.md (base)
+++ b/your draft
@@ -1,3 +1,4 @@
 # Hello
 - 第一行
 - 第二行
+- 我新增的第三行

== 外部修改 (base → 磁盘当前) ==

--- a/notes/note-b.md (base)
+++ b/current disk
@@ -1,3 +1,3 @@
 # Hello
 - 第一行
-- 第二行
+- Agent 改写第二行

---

请分析两处修改，输出合并后的完整文件内容。
```
