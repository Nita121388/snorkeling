# implement.md — 执行计划

> 每步结束都可停下；判据先行（先红后绿），不接受「我看了一下没问题」。

## 冻结的基线数字（2026-11-06 实测）

| 判据 | 基线 | 本包目标 |
|---|---|---|
| `npx vitest run frontend/app/tab/ frontend/app/block/` | `27 files / 225 passed` | ≥ 225 + 新增 |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json \| grep -c "error TS"` | `47` | ≤ 47 |
| `node design/prototypes/move-block-modal-v3/selfcheck.mjs` | `26/26` | 26/26（不许掉） |

## Step 1 · 判据先行（红）

新建 `frontend/app/tab/tab-target-modal.test.tsx`（纯 DOM 断言，走项目已有 jsdom 环境），覆盖：

1. `rowActions` 缺失 → 不渲染 `.row-icons`，仍渲染旧的 `.tab-target-action-label`（**保 `widgets.tsx` 行为**）
2. `onCreate` 缺失 → 不渲染 `[data-new-tab]` 行
3. `onCreate` 给了 → `[data-new-tab]` 是列表**首行**，`aria-disabled === "false"`
4. 行容器 `tagName === "DIV"` 且 `role === "button"`（**不是 `<button>`**）
5. 行内恰好 2 个 `.row-icon-btn`，`title` 与 `aria-label` 都非空
6. 点行体 → 调 `rowActions[primary].run`
7. 点第二个图标 → 调 `rowActions[1].run`（与 6 是**不同**动作）
8. working 期间：行 `aria-disabled=true`，两个图标 `disabled=true`
9. `onCreate` 行点击 → 调 `onCreate`，且**不**调任何 `rowActions[].run`
10. 空态（`workspace.tabids` 只有当前 tab）→ 仍渲染 `[data-new-tab]`，且显示 `No other tabs`
11. `onSelect` 抛错 → 渲染 `[data-error]` 文本，行恢复可用
12. 守则：`makeBlockMoveMenuItems()` 产出**恰好 1 条**，label 以 `Move to Tab` 开头
13. 守则：`makeBlockMoveMenuItems()` 在 `moveContext` 非空时**永远**返回 1 条（不依赖 block 类型 / view）

同时把 `frontend/app/block/blockframe-header.menu.test.ts`（新文件）用于 12/13。

- 命令 → 期望：`npx vitest run frontend/app/tab/tab-target-modal.test.tsx frontend/app/block/blockframe-header.menu.test.ts` → **红**（13 failed 左右；具体数落 `queue gate --gate g2 --red-proof`）
- 这一步**不写实现**，只写测试（`rowActions` / `onCreate` 先以 `any` 断言绕过 tsc，或用类型注释临时放宽——实现落地后收紧）。

> ⚠️ 红证明必须写进 G2 凭据：**命令 + 输出摘要 + commit sha**。

## Step 2 · `TabTargetModal` 结构改造（转绿 1–11）

`frontend/app/tab/tab-target-modal.tsx`：

- 抽 `TabRow` 子组件：`div[role=button] tabIndex=0 aria-disabled` + 可选 `.row-icons`
- 新增 props：`onCreate?` / `createHint?` / `rowActions?`（`emptyLabel` 已存在，确认即可）
- `working` 状态：`{ key: string; actionKey: string } | null`（`key = tabId | "__new__"`）
- spinner 只替换**被点图标的内容**，保留按钮本体（`data-act` / `title` / `aria-label` 不能丢）
- 行体 Enter / Space → primary 动作
- 错误行沿用 `[data-error]`

- 命令 → 期望：同 Step 1 命令 → 11 passed（12/13 仍红，属 Step 3）

## Step 3 · 菜单收敛（转绿 12–13）

`frontend/app/block/blockframe-header.tsx`：

- `makeBlockMoveMenuItems()` 返回 `[{ label: "Move to Tab…", click: → onOpenModal() }]`
- 删 `BlockTabActionMode` / `mode` prop / `onCopyToExistingTab`
- `MoveBlockToTabModal` 改为无模式：传 `rowActions`（move/copy）+ `onCreate`（建 tab + 放入）
- `MoveBlockMenuContext` 收敛

- 命令 → 期望：Step 1 命令 → **13 passed**

## Step 4 · 样式

`frontend/app/tab/tab.scss`：

- 新增 `.new-tab-row`（`.plus-box` 虚线 → hover 实心 accent）、`.list-divider`、`.row-icons`、`.row-icon-btn`
- `.row-icons` 默认 `opacity: 0`，`.tab-target-row:hover .row-icons` + `.tab-target-row:focus-within .row-icons` → `1`
- **保留** `.tab-target-action*`（`widgets.tsx` 的 Create 弹窗还在用）
- 只用 token 色（`--action-bg-color` / `--action-text-color` / `--hover-bg-color` / `--border-color` / `--secondary-text-color`），无硬编码色值

- 命令 → 期望：`npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `47`
- 命令 → 期望：`npx vitest run frontend/app/tab/ frontend/app/block/` → ≥ 238

## Step 5 · 入口覆盖（视图右键）

给漏接的视图补 `appendBlockMoveMenuItems`（用已有 helper，不新造机制）：

| 文件 | 位置 |
|---|---|
| `frontend/app/view/preview/preview-model.tsx` | `getSettingsMenuItems()` 已在 `⋯` 路径生效；补**内容区右键**（若有独立 `showContextMenu`） |

先在 Step 5 开头跑一遍 grep 确认实际漏哪些：

```bash
grep -rn "ContextMenuModel.getInstance().showContextMenu" --include=*.tsx frontend/app/view/ | grep -v appendBlockMoveMenuItems
```

对该命令输出的每一处，判定「这是 block 级菜单还是元素级菜单」：
- **block 级** → 补 `appendBlockMoveMenuItems`
- **元素级**（如某个 iconbutton 的 longClick 小菜单）→ 不补，写进 `docs/project/` 说明

- 命令 → 期望：该 grep 的 block 级条目全部带 `appendBlockMoveMenuItems`

## Step 6 · 真机验证台

新建 `scripts/verify/move-block-tab/verify.mjs`（复制 `_template/verify.mjs`）：

| # | 断言 |
|---|---|
| 1 | 任意 block 的 `⋯` 菜单文本包含 `Move to Tab…` 且**不包含** `Move to New Tab` / `Copy to Existing Tab` |
| 2 | 点开弹窗 → 标题 `Move Block`；**不存在** `[data-mode]` / `.seg` 类元素 |
| 3 | `[data-new-tab]` 是弹窗列表首行且可点 |
| 4 | 行容器 `tagName === "DIV"`、`role === "button"` |
| 5 | 每行恰好 2 个 `.row-icon-btn`，`title`/`aria-label` 均非空 |
| 6 | 真实指针 hover 行 → `.row-icons` `opacity === 1`；移开 → `0` |
| 7 | 点 `New tab` 的 `→` → 新建 tab 出现且 block 被移入（tab 名 = 源 tab 名，或源名 + 数字） |
| 8 | 点某 tab 行的 `⧉` → 源 tab 里 block 仍在（copy 语义） |
| 9 | 点某 tab 行的行体 → 源 tab 里 block 消失（move 语义） |
| 10 | 在 markdown 预览块里右键 → 菜单含 `Move to Tab…`（覆盖 R5） |

- 命令 → 期望：`node scripts/verify/move-block-tab/verify.mjs` → `10/10`，`exit 0`
- 登记进 `scripts/verify/README.md` 的 area 表；结论写 `docs/project/verify-ledger.md` 一行

## Step 7 · 收尾三连

```bash
npx vitest run frontend/app/tab/ frontend/app/block/            # ≥ 238
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json | grep -c "error TS"   # 47
node scripts/verify/move-block-tab/verify.mjs                    # 10/10
node design/prototypes/move-block-modal-v3/selfcheck.mjs         # 26/26（结构同步旁证）
```

再做：
- 原型 README 状态 `▲` → `●`（已落地），`__REVIEW_GUIDE__.md` 同步
- `node scripts/verify/index.mjs` 确认台账已追加
- `node loop/queue.mjs prove --id <id>` 复跑判据

## 评审门 / 回滚点

| 门 | 触发 | 回滚点 |
|---|---|---|
| 两段提交 | ① modal 结构（Step 2+4）② 菜单 + 覆盖（Step 3+5） | 任一单独 `git revert` |
| 契约冻结 | Step 2 改动 `TabTargetModal` 后，`widgets.tsx` 的 Create 弹窗必须零行为变化（Step 1 的用例 1/2 守着） | 删新 prop 即回旧行为 |
