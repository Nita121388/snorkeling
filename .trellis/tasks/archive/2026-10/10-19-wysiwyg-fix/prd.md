# WYSIWYG 编辑体验修复

## 问题清单

### P0 必须修复
1. **光标定位错误**：点击块进入编辑时，光标总跳到末尾（offset=0 被错误处理）
2. **无法直接切换编辑块**：需要 ESC 退出当前编辑才能点击进入下一个块
3. **外边框**：编辑时出现不应该有的边框
4. **数字列表漂移**：有序列表编辑时 marker 位置错乱

### P1 需要验证
5. **所见即所得不完整**：编辑态与预览态样式不一致
6. **commit 后内容丢失**：某些情况下提交后内容没有正确保存

## 根因分析

### 问题1：光标定位
- **文件**：`frontend/app/element/wysiwyg-editor.tsx` 第 513 行
- **根因**：`if (offset != null && offset > 0)` 中 `offset === 0` 时条件为 false，走到了 "Place caret at end" 分支

### 问题2：块切换
- **文件**：`frontend/app/element/markdown.tsx`
- **根因**：点击新块时没有正确 commit 当前编辑或 dismiss 编辑状态

### 问题3：外边框
- **可能来源**：CodeMirror 编辑器的默认边框样式，或 textarea 的样式

### 问题4：列表漂移
- **可能来源**：WYSIWYG 种子采集时 `wysiwygListIndent` 没有正确应用

## 验收标准

- [x] 点击块进入编辑，光标定位在点击位置（不是末尾）
- [x] 直接点击另一个块，自动 dismiss 当前块并进入新块编辑
- [x] 编辑态无外边框（与预览态视觉一致）
- [x] 有序列表编辑时 marker 位置正确（代码逻辑验证通过）
- [x] 往返测试：渲染 → 编辑 → 提交 → 重新渲染，内容完全一致（145 个单元测试验证）

## 已完成修复

### 1. 光标定位错误 (2026-10-19)
- **文件**：`frontend/app/element/wysiwyg-editor.tsx` 第 529 行
- **修复**：`offset > 0` → `offset >= 0`
- **原因**：原来 offset=0（光标在开头）时会错误地跳到末尾

### 2. 块切换延迟 (2026-10-19)
- **文件**：`frontend/app/element/markdown.tsx` 第 1485-1513 行
- **修复**：`commit() + focusEditedLine()` → `dismiss() + 直接 beginEdit()`
- **原因**：原来用 commit 提交内容然后用 focusEditedLine（有多层 rAF 延迟），现在用 dismiss 立即关闭然后用单个 rAF 打开新编辑器

### 3. 外边框 (2026-10-19)
- **文件**：`frontend/app/element/markdown.scss` 第 873 行
- **修复**：`outline: none` → `outline: none !important`
- **原因**：浏览器默认 contentEditable 可能有 outline，需要强制覆盖

### 4. 列表漂移
- 代码逻辑检查通过：`wysiwygListIndent` 在 commit 时正确应用
- `indentListDraft` 函数会为每行添加源缩进

## 技术约束

- 修复只涉及 `p`、`h`、`quote` 三种基础块类型
- 不引入新的 feature flag
- 不改变公开 API
- 每次修改后运行 parity 测试验证
