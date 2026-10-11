# 实施计划：列表结构自持 + 规范化

按顺序执行；每项完成后跑一次 `npx vitest run frontend/app/element` + `npx tsc --noEmit`。

## 0. 开工前

- [ ] `pwd && git branch --show-current` → `~/Primary/projects/snorkeling-wysiwyg` + `feat/wysiwyg-block-editor`
- [ ] 读 `prd.md`（含沙箱与踩坑说明）与 `design.md`（含算法与调用点）
- [ ] 基线确认：`npx vitest run frontend/app/element` 全绿；`npx tsc --noEmit` = 68

## 1. F1 序列化兜底（先做，单独即止血）

- [ ] 先写失败测试：`probe` HTML（游离子列表）→ 期望包含 `  - item C`
- [ ] 改 `markdown-transform/dom-to-markdown.ts` 的 `serializeListDomToMarkdown`：按 `children` 顺序遍历，
      `UL/OL` 直接子元素按嵌套输出（见 design F1 代码骨架）
- [ ] 回归：现有列表单测（bullet/ordered/task/nested/loose）全绿
- [ ] 提交：`fix(markdown): 列表序列化不再丢弃游离子列表（Tab 缩进丢项）`

## 2. F2 normalizeListDom

- [ ] 新增 `markdown-transform/list-dom.ts`：`normalizeListDom(root)`（design F2 骨架）
- [ ] 单测：游离子列表并入前一个 `li`；无前一个 li 时挂到最后一项；列表内无 li 时提升为顶层且内容保留；
      幂等 `normalize(normalize(x)) === normalize(x)`
- [ ] 接到结构变更点：`wysiwyg-editor.tsx` 的 Enter / Backspace / 粘贴 / 种子落地后各调一次
      （Enter/Backspace 走的是原生默认动作，需要在 `beforeinput` 或 `keyup` 之后调用；实现时选最稳的钩子并注释原因）
- [ ] 提交：`fix(markdown): 列表 DOM 结构规范化（嵌套列表只能挂在 li 之下）`

## 3. F3 Tab / Shift+Tab 自持

- [ ] 单测先行（jsdom 直调）：Tab 缩进到前一个兄弟 li；Shift+Tab 降级到父 li 之后；
      第一项 Tab no-op；顶层 Shift+Tab no-op；降级后父列表为空则删除
- [ ] 改 `wysiwyg-editor.tsx` 的 `applyListIndent`：去掉 `document.execCommand`，按 design F3 实现
- [ ] 保持接口签名与调用方（`markdown.tsx:2043`）不变
- [ ] 提交：`fix(markdown): 列表 Tab/Shift+Tab 改为自持结构操作（不再用 execCommand）`

## 4. F4 caret 锚定

- [ ] `list-dom.ts` 增 `plantCaretAnchor` / `focusByAnchor`（design F4 规则）
- [ ] 单测：锚定后选区回到原边界；变更后 DOM 内无残留 `wbr`
- [ ] 接到 `applyListIndent`（变更前后各一次）；如原生 Enter/Backspace 后也丢光标，一并接上
- [ ] 提交：`fix(markdown): 列表结构变更用 <wbr> 锚定并恢复光标`

## 5. 沙箱实测（窗口必须可见，否则 CDP 输入被丢弃）

- [ ] `node scripts/inspect-electron-ui.mjs --endpoint http://127.0.0.1:9333 --target "Wave Terminal - T1" ...`
- [ ] 场景 1：`- item C` 上 Tab（`key Tab`）→ 点空白提交 → `sed` 看源码：项数不变、C 变缩进项
- [ ] 场景 2：Shift+Tab 变回顶层
- [ ] 场景 3：第一项 Tab / 顶层 Shift+Tab → 源码无变化
- [ ] 场景 4：结构操作后 `type "XY"` → 字符进入被操作项
- [ ] 草稿文件可用 `.runcfg/scratch-ws/.backup-lists.md` 还原（`cp` 后 `location.reload()`）

## 6. 收尾

- [ ] 全量：`npx vitest run frontend/app/element` 全绿；`npx tsc --noEmit` = 68
- [ ] 更新 spec：`component-guidelines.md` 的列表 Pattern 补「结构自持 + 规范化 + 序列化兜底」与
      「CDP 输入不投递给隐藏渲染进程」的调试提示
- [ ] 更新 `prd.md` 的范围变更记录（div 块化推迟的原因与证据）
- [ ] 归档任务并推送

## 回滚点

- 每个 F 一个 commit；F1 与 F3 可单独 revert（F3 revert 后回到 execCommand，配合 F1/F2 仍不丢内容）
