# 阶段 4 切片：结构操作统一模型（重排/删除/复制 + 块级逆操作闭环）

父任务 `10-11-wysiwyg-overhaul` 已完成 4 个子任务（L1–L3 达标）。本任务开阶段 4 的第一片。

## 为什么是这一片

现状侦察结论：

- `moveBlockRange` / `deleteBlockRange` 等**纯函数已存在**，但它们是「谁需要谁调」的散装状态：
  键盘重排、拖拽重排、退格合并各自直接调用，**没有统一入口、没有逆操作数据**。
- `BlockEditIntent`（`block-model/editor-controller.ts`）目前**只有内容类意图**
  （turn-into / inline-style / toggle-task / set-code-lang / renumber-list / replace-content）
  —— **没有任何结构操作意图**。
- 缺口：**块级删除**与**块级复制/重复**没有用户入口（退格合并 ≠ 删除块）。
- step3 已备好前提：块身份 `data-block-id`、`EditorHistoryOp` 块级逆操作数据。

## Requirements

- **R1 统一意图**：`BlockEditIntent` 增 `move-block` / `delete-block` / `duplicate-block`；
  控制器**委派既有纯函数**（不重复实现），与内容类意图同一入口、同一返回契约
  `{ text, caret? }`。
- **R2 块级逆操作闭环**：每种结构操作产出结构化 op，且**可独立求逆**：
  新增 `invertStructuralOp(op)`，测试断言 `invert(op)(after) === before`
  （不依赖历史快照 —— 这才是「闭环」，也是将来语义化撤销/操作日志的基础）。
  * move：`{blockId, fromRange, toRange}` → 逆操作是移回。
  * delete：`{blockId, range, content}` → 逆操作是把 content 插回原位。
  * duplicate：`{blockId, range, copyRange}` → 逆操作是删掉副本。
- **R3 用户入口补齐**：块级**删除**（Cmd/Ctrl+Shift+K）与块级**复制/重复**（Cmd/Ctrl+Shift+D）
  接进统一意图 + 历史记账；键盘重排（Cmd/Ctrl+Shift+↑↓）与拖拽重排改走同一意图，
  **行为不变**。
- **R4 目标解析用块身份**：命令入口拿 DOM 元素 / `data-block-id` 解析**当前**行号
  （复用 step3 的重定位思路），不用可能陈旧的行号。
- **R5 不回归**：内容类意图、现有重排/退格行为、undo/redo 语义全部不变。

## Acceptance Criteria

- [ ] 单测：三种结构操作经控制器 apply 后文本正确（含多块范围、首末边界、目标在源之前/之后）
- [ ] 单测：`invert(op)(after) === before` 对三种操作各成立（含多块范围）
- [ ] 单测：控制器对结构意图的返回含 `op`，且与 `invert` 自洽
- [ ] 单测：块级删除 = 删除整块（含其分隔空行，不留双空行）；块级复制 = 副本紧随其后
- [ ] 单测：键盘重排走统一意图后，结果与旧实现**逐字节一致**（回归基线）
- [ ] 沙箱实测：重排（键盘 + 拖拽）/ 删除 / 复制 各一遍，且每一步 undo 都精确回到上一步
- [ ] `npx vitest run frontend/app/element` 全绿；`npx tsc --noEmit` 无新增（基线 68）

## 明确不做（留给后续切片）

- 跨块多选（G10 已判：与单块坐标模型不匹配）
- 结构操作的类型专属行为（表格行列、列表跨层移动的语义化「移动进/出列表」）
- 操作日志 / 语义化 redo（本片只保证「可独立求逆」这一数据能力）
