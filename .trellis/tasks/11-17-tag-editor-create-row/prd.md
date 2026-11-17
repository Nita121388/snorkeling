# Agent 卡片列表属性：精确值被子串命中挡住，无法新增创建行

## 现象

Agent 卡片的列表属性（multi_select，Tags / 自定义列表）编辑浮层里，搜索「设计中」
时候选项命中已存在的「原型设计中」（子串包含），但「创建 设计中」行**不出现**，
导致无法新增「设计中」这个精确值；回车还会把 activeIndex=0 的「原型设计中」选进去。

## 根因（代码事实）

`frontend/app/element/property-editor/tag-editor.tsx`（agent 卡属性面板与 md 预览属性卡共用；
md 侧 `preview/plugins/md-properties/property-tag-editor.tsx` 只是 `export *` 兼容层）：

1. `filterOptions` 用**子串包含**过滤显示列表 —— `"设计中" ⊂ "原型设计中"` → `filtered` 非空（这部分是对的）；
2. `canCreateOption` 用**精确匹配**判断能否创建 —— 返回 `true`（这部分也是对的）；
3. **渲染条件 `{showCreate && filtered.length === 0 && …}` 把创建行挡住了** ← 真正的 bug：
   只要任何候选子串命中，创建行就永不渲染；
4. `Enter` 分支 `if (filtered.length > 0 && activeIndex < filtered.length)` 先于 `showCreate`，
   回车选中的是子串命中的第一行（「原型设计中」），同样走不到创建。

一句话：显示过滤（子串）与创建门（精确）两套判据混用，且创建行被「零匹配」闸绑死。

## Requirements

- **R1 创建行可见**：`showCreate`（精确值不存在）为真时就渲染创建行，不再要求 `filtered.length === 0`；
  创建行固定排在过滤结果之后；`is-active` 跟随 `activeIndex === filtered.length`。
- **R2 键盘可达**：`ArrowDown/ArrowUp` 的边界把创建行纳入（`filtered.length + (showCreate ? 1 : 0)`）；
  高亮到创建行时 `Enter` 创建 `draft.trim()`。
- **R3 回车语义**：输入完整新值直接回车 → 创建（保留「输入部分前缀浏览、回车选第一行」的现状，
  仅当 `showCreate` 且用户未用方向键/悬停主动挑选过时，Enter 走创建分支）；
  用 `touched` 标志区分「刚输入」与「主动挑选过」，两种流都不误伤。
- **R4 空态**：空态提示只在 `filtered.length === 0 && !showCreate` 时出现。
- **R5 写入路径不变**：仍走 `onChange` → `commitDropdown` → `setSessionProperty`，不改 Go 侧。
- **R6 向后兼容**：`canCreateOption` / `filterOptions` 纯函数签名不变（或只加可选参数），
  既有测试（计数 4 条 + md 侧 filterOptions/canCreateOption 既有断言）全部保持绿。

## Non-goals

- 不改 `filterOptions` 的子串匹配语义（显示过滤保留子串，创建判断保留精确）。
- 不动 md 预览侧兼容层文件。
- 不做 Notion 式「创建行置顶」等视觉重排。

## 验收判据

命令 → 期望输出：

1. `npx vitest run frontend/app/element/property-editor/tag-editor.dom.test.tsx` → 全绿，
   且新增红证转绿：`options=["原型设计中"]` + 输入「设计中」→ 创建行可见，点击回调 `["设计中"]`。
2. 同测试内：输入「设计中」未挑选时按 Enter → `onChange` 收到 `["设计中"]`（不是 `["原型设计中"]`）。
3. 同测试内：方向键高亮「原型设计中」后 Enter → `onChange` 收到 `["原型设计中"]`（浏览流不误伤）。
4. `npx vitest run frontend/app/view/preview/plugins/md-properties/property-tag-editor.test.tsx` → 全绿（共享实现回归门）。
