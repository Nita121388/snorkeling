# 设计：结构操作统一模型

## 现状（开工前已核实）

| 能力 | 现状 |
|---|---|
| `moveBlockRange(fullText, startLine, endLine, targetLine, mode)` | 已存在（`markdown-inline-edit.tsx`），拖拽重排 + 键盘重排都在直接调 |
| `deleteBlockRange(fullText, startLine, endLine)` | 已存在，退格合并路径在用 |
| `BlockEditIntent` | 只有内容类意图，**无结构意图** |
| 块级删除 / 复制入口 | **缺** |
| undo | 快照式（`record(before, after, op?)`），行为正确；`op` 是 step3 新增的数据位 |

## 交付切分（3 个独立 commit）

| # | 交付 | 文件 |
|---|---|---|
| M1 | 结构意图 + 逆操作纯函数（模型层，无 UI 变化） | `block-model/editor-controller.ts`、新 `markdown-transform/structural-ops.ts`(+test) |
| M2 | 键盘重排/拖拽重排改走统一意图（行为逐字节不变） | `markdown.tsx`、`markdown-inline-edit.tsx` |
| M3 | 块级删除（Cmd+Shift+K）+ 块级复制（Cmd+Shift+D）+ 记账 | `markdown.tsx`(+test) |

---

## M1 结构意图 + 逆操作

### 新增 `markdown-transform/structural-ops.ts`（纯函数，可直测）

```ts
export type StructuralOp =
    | { type: "move"; blockId?: string; from: LineRange; to: LineRange }
    | { type: "delete"; blockId?: string; range: LineRange; content: string }
    | { type: "duplicate"; blockId?: string; range: LineRange; copyRange: LineRange };

/** 独立求逆：把 op 应用到 after 文本上，应得到 before。不依赖历史快照。 */
export function invertStructuralOp(op: StructuralOp): (text: string) => string;
```

逆操作语义（与既有纯函数对齐，避免第二套行号算术）：

- `move` 的逆 = 再把 `from` 长度的那段从 `to` 移回 `from.start`
  —— 用同一个 `moveBlockRange` 实现（`invertStruct` 不重复写搬移逻辑）。
- `delete` 的逆 = 在 `range.start` 处把 `content`（含其前后分隔空行的原样文本）插回。
- `duplicate` 的逆 = 删除 `copyRange`。

**关键契约**：`op.range`/`from`/`to` 一律是**操作发生时的行号**（before 坐标）；
`invert` 用 `after` 坐标工作 —— 所以 `invert` 必须自带坐标换算（move 的逆要把
`to` 当源、`from.start` 当目标，删除/插入要按 after 的行数校验边界）。
测试就是这条契约的护栏：`invert(op)(after) === before`。

### 控制器扩展

```ts
export type BlockEditIntent =
    | ...既有内容类
    | { type: "move-block"; block: Block; targetLine: number; mode: "before" | "after" }
    | { type: "delete-block"; block: Block }
    | { type: "duplicate-block"; block: Block };

export interface EditControllerResult {
    text: string;
    caret?: number;
    /** 结构操作的可逆数据（内容类意图不带）。 */
    op?: StructuralOp;
}
```

`apply` 的三条结构分支**委派**既有纯函数（`moveBlockRange` / `deleteBlockRange`），
自己只负责：范围推导、`op` 构造、行号边界校验。**不得再写第二份搬移/删除算术。**

---

## M2 重排改走统一意图（行为不变）

`markdown.tsx` 现在两处直接调 `moveBlockRange`：`moveFocusedBlock`（键盘，~1999）与拖拽
drop 处理（~2485）。改为经 `editorController.apply({type:"move-block",…})`，并把返回的
`op` 随 `record(...)` 记账。

**回归护栏**：加一条单测断言「同一输入下，统一意图路径的结果与旧 `moveBlockRange`
调用逐字节相同」（用现有 P3 键盘重排用例的输入）。

---

## M3 块级删除 / 复制

- **删除**：整块（`block.startLine..endLine`）+ **折叠其分隔空行**（与 `deleteBlockRange`
  一致，避免留下双空行）。光标落到下一块的起始（末块则落到上一块末尾）。
- **复制**：副本紧随其后，中间保留一个空行分隔（与块的 bracket 空行约定一致）；
  复制后焦点留在**原块**还是副本？——**留在副本**（对标思源/Obsidian：重复后继续编辑副本）。
  这条要在设计评审时定，我选副本（连续两次复制会得到 A A A 且光标在最后一个）。
- 快捷键：`Cmd/Ctrl+Shift+K` 删除块、`Cmd/Ctrl+Shift+D` 复制块。检查不与现有快捷键冲突
  （VSCode 风格；Obsidian 也用这两个）。
- 目标解析：从**当前编辑会话/悬停块元素**取 `data-source-line` 与 `data-block-id`，
  用块身份重定位到当前行号（R4），不用陈旧行号。

---

## 验证清单

```bash
npx vitest run frontend/app/element     # 全绿（基线 48 文件 / 711 用例）
npx tsc --noEmit                        # 无新增（基线 68）
```

沙箱（`.runcfg/scratch`，窗口必须可见，否则 CDP 输入被丢弃）：
1. 键盘重排 Cmd+Shift+↑/↓ → 块顺序正确、内容不丢
2. 块级删除 → 该块消失且**不多不少**空行
3. 块级复制 → 副本紧随其后、内容一致
4. 上述每一步 undo → **逐字节回到上一步**（这是「结构操作 = 块级逆操作」的最终验收）

## 回滚

M1 纯新增（无 UI 变化）可单独 revert；M2 依赖 M1（revert M1 时 M2 需一并 revert）；
M3 依赖 M1 的意图与 op。
