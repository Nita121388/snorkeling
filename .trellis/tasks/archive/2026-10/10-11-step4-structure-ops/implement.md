# 实施计划：结构操作统一模型

## 0. 开工前

- [ ] `pwd && git branch --show-current` → worktree + `feat/wysiwyg-block-editor`
- [ ] 读 `prd.md` / `design.md`（M1 的「不写第二份搬移算术」与「invert(op)(after)===before」是硬契约）
- [ ] 基线：48 文件 / 711 用例全绿；tsc 68
- [ ] 先看 `moveBlockRange` / `deleteBlockRange` 的既有实现与调用点（摸清边界语义）

## 1. M1 结构意图 + 逆操作

- [ ] `markdown-transform/structural-ops.ts`：`StructuralOp` + `invertStructuralOp`
      （move 的逆复用 `moveBlockRange`；delete 的逆按 after 坐标插回；duplicate 的逆删副本）
- [ ] 单测：三种操作 `invert(op)(after) === before`（含多块范围、首末边界、目标在源前后两侧）
- [ ] `editor-controller.ts`：三类结构意图 + `EditControllerResult.op`；`apply` 委派既有纯函数
- [ ] 单测：控制器 apply 结果文本正确 + 返回 op 与 invert 自洽
- [ ] 提交：`feat(block): 结构操作进入统一意图模型 + 可独立求逆的块级 op`

## 2. M2 重排改走统一意图

- [ ] `markdown.tsx`：`moveFocusedBlock` 与拖拽 drop 改调 `editorController.apply({type:"move-block"})`
      + `record(..., op)`
- [ ] 回归单测：与旧 `moveBlockRange` 直接调用**逐字节一致**
- [ ] 提交：`refactor(block): 键盘/拖拽重排改走统一结构意图（行为逐字节不变）`

## 3. M3 块级删除 / 复制

- [ ] 快捷键 `Cmd/Ctrl+Shift+K`（删除块）、`Cmd/Ctrl+Shift+D`（复制块），检查冲突
- [ ] 目标解析用块身份重定位取当前行号（复用 step3 思路）
- [ ] 单测：删除不留双空行、末块/首块边界、光标落点；复制副本紧随其后且内容一致
- [ ] 提交：`feat(block): 块级删除与复制（Cmd+Shift+K / Cmd+Shift+D）`

## 4. 沙箱实测

- [ ] 键盘重排 / 拖拽重排 / 删除 / 复制 各一遍；**每一步 undo 逐字节回到上一步**
- [ ] 每步前后 `md5` + 关键行 `sed -n`；草稿可从 `.backup-*.md` 还原

## 5. 收尾

- [ ] 全量 vitest + tsc（不退化）
- [ ] spec：`component-guidelines.md` 补「结构操作统一意图 + 可逆 op」Pattern
- [ ] 归档 + 推送；Obsidian 开发记录 + TODO；父任务（已归档）的覆盖矩阵更新

## 回滚点

M1 纯新增；M2 依赖 M1；M3 依赖 M1
