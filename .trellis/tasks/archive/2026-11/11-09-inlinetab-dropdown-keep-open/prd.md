# Inline Tab 更多下拉：删除后保持菜单打开，支持连续删除

## Goal

Tab 化 Block 的「更多」下拉菜单点击 × / Delete 后菜单会关闭，无法连续删除多个内联 Tab。修复为删除后保持菜单打开（仅当溢出消失或组内只剩 1 个 Tab 时自然关闭），并让键盘 Delete 连续删除时焦点自动落到下一条。

## Requirements

- `InlineTabDropdownMenu`（`frontend/app/block/inlinetab-dropdown.tsx`）的 × 按钮点击后**不再**调用 `onOpenChange(false)`。
- 键盘 Delete / Backspace 删除当前聚焦行后**不再**关闭菜单。
- 删除后行列表随 store 更新自动刷新；菜单保持锚定在「更多」药丸上。
- 保留现有的合理自动关闭：
  - `block.tsx` 溢出消失量测 effect 关闭菜单（药丸同时隐藏，锚点不存在）；
  - 组内 block 数量降到 1，整个 inline-tab 壳卸载，菜单随之消失。
- 键盘连续删除：删除一条后把焦点落到同索引（越界则最后一条）的行；无剩余行时把焦点移回菜单容器，避免焦点掉到 body 导致后续 Delete 失效。
- 用户在脏数据确认弹窗里取消删除时，菜单也应保持打开。

## Acceptance Criteria

- [x] `inlinetab-dropdown.test.tsx` 调整断言：点击 × / 按 Delete 后 `onOpenChange` 不被调用（或不被以 `false` 调用）。
- [x] 新增断言：删除后焦点落在同索引的下一行；删到最后一行时焦点回落到菜单容器。
- [x] `npx vitest run frontend/app/block/inlinetab-dropdown.test.tsx` 全绿。
- [x] 全仓 `npm run lint`（或项目约定的前端类型/lint 命令）对改动文件无新增报错。
- [x] 代码注释同步：删掉「删除后关闭菜单」的旧描述。

## Notes

- 改动只涉及 `frontend/app/block/inlinetab-dropdown.tsx` 与其单测，不触碰 `block.tsx` 的溢出量测逻辑。
