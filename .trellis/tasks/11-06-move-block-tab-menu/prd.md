> **Confirmed: 2026-11-06 @nita**

# Move Block to Tab：菜单 4 → 1 条 + 弹窗内新建 / 每行双图标动作

## Goal

把「把 block 送到另一个 tab」这件事从**四条菜单 + 一个不能新建的弹窗**，收敛成**一条菜单 + 一个能选也能建的弹窗**；
同时让这个入口在**所有 block 视图**里都存在，而不是只有 agent / 终端块。

目标形态（原型已可点：`design/prototypes/move-block-modal-v3/`）：

- block 菜单里只有一条 `Move to Tab…`；
- 打开后是一个**没有模式状态**的 tab 列表：`New tab` 行置顶且永远可用，其余行 hover 出两个图标
  `→`（Move）/ `⧉`（Copy）；
- 点行体 = Move（快路径），点 `⧉` = Copy；
- 任何非 preview / 非 ephemeral 的 block 都能从 `⋯` 菜单进到这个弹窗。

## 做什么

### R1 菜单收敛：4 条 → 1 条

`frontend/app/block/blockframe-header.tsx` 的 `makeBlockMoveMenuItems()` 现在产出 4 条：

| 现状菜单项 | 现状行为 |
|---|---|
| `Move to New Tab` | 直接 `MoveBlockToNewTab(blockId, sourceTabName)`，无确认、名字不可见 |
| `Move to Existing Tab...` | 开 `TabTargetModal`（`mode="move"`） |
| `Copy to New Tab` | 直接 `CopyBlockToNewTab(...)` |
| `Copy to Existing Tab...` | 开 `TabTargetModal`（`mode="copy"`） |

改为**只产出 1 条** `Move to Tab…`，点击打开统一弹窗。菜单层不再区分 New / Existing、不再区分 Move / Copy。

### R2 弹窗内「选择 + 新建」合流

`frontend/app/tab/tab-target-modal.tsx` 增加一个**可选的**新建入口：

- `New tab` 行**置顶**，且**永远可用**（不受「有没有其它 tab」影响）；
- `New tab` 行在弹窗里是唯一的「建 tab」入口，点它 = 建 tab + 把 block 放进去；
- 空态（当前只有 1 个 tab）时该行仍可用，下方保留 `No other tabs` 文案；
- 新增 tab 的名字由后端派生（沿用源 tab 名 + `MakeUniqueTabName` 去重），前端不提供输入框。

### R3 动作选择：每行两个图标，取消模式切换

- 行右侧 hover 浮现**两个 icon 按钮**：`→` Move、`⧉` Copy；
- **点行体 = Move**（保留「点一下就走」的快路径）；
- 弹窗内**不再有 Move/Copy 模式状态**，标题固定 `Move Block`；
- 两个 icon 按钮必须同时写 `title` 与 `aria-label`（项目硬约束，见 `quality-guidelines.md`「icon-only 按钮的硬约束」）；
- `hover` 才浮现的行内动作必须带 `focus-visible:opacity-100`（键盘用户不能看不到）。

### R4 行容器结构改造（图标按钮不能嵌套在按钮里）

`TabTargetRow` 当前整行是 `<button>`。往按钮里塞两个 `<button>` 是**非法嵌套**，点击会串
（同类坑已记录在 `frontend/app/session-overview/overview-board.tsx:141`）。

- 行容器改为 `div[role="button"]` + `tabIndex=0` + `aria-disabled`；
- 行内两个图标是真正的 `<button>`，点击 `stopPropagation`；
- 行体 Enter / Space 触发 Move（与鼠标点击等价）；
- `working` 状态下行体与两个图标都不可再点。

### R5 入口全覆盖

「只支持 agent Block」的真实成因不是按类型拦，而是**入口依赖各 view 主动接力**
（`appendBlockMoveMenuItems`）。本包要求：

- `⋯` 菜单作为保底入口：任意 `!preview && !ephemeral` block 都能看到 `Move to Tab…`（当前已成立，加守卫单测锁住）；
- 补齐目前**漏接**的视图右键菜单，让右键也能看到入口；
- 新增一条守卫单测，锁住「菜单只有 1 条」，防止以后有人把「新建」又拆回菜单。

## 不做什么

- 不做「Move / Copy 以外的第三种动作」（如 Move whole tab / Duplicate tab）；
- 不做跨 workspace 移动（后端 `MoveBlockToTab` 本身拒绝跨 workspace，沿用）；
- 不做 New tab 的命名输入框（重命名走已有的 tab 重命名）；
- 不改 `MoveBlockToTab` / `CopyBlockToTab` / `MoveBlockToNewTab` / `CopyBlockToNewTab` 的后端语义；
- 不改 `widgets.tsx` 里 `TabTargetModal` 的既有用法（它是 Create 语义，不传新 prop 时行为必须逐字节不变）；
- 不改 inline tab 组的内部结构与拖拽；
- 不做撤销（移动后可手工移回）。

## 验收判据

- [ ] `npx vitest run frontend/app/tab/ frontend/app/block/` → `225+ passed`（基线 225，新增必须加上去）
- [ ] `npx vitest run frontend/app/tab/tab-target-modal.test.tsx` → 新增文件全绿（计数见 implement.md 冻结值）
- [ ] `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `47`（既有基线，不涨）
- [ ] `node scripts/verify/move-block-tab/verify.mjs` → 全绿（真机断言，见 implement.md）
- [ ] `node design/prototypes/move-block-modal-v3/selfcheck.mjs` → `26/26`（原型与真实实现结构一致性的旁证）

新增判据必须能看见本包的缺陷（对修复前代码必须红）：

- **菜单条数**：`makeBlockMoveMenuItems()` 产出**恰好 1 条**且 label 以 `Move to Tab` 开头 →
  对旧实现（4 条）必须红。
- **无模式状态**：渲染出的弹窗里不存在 `data-mode` / 分段控件，标题恒为 `Move Block` →
  对旧实现（`mode="copy"` 时标题为 `Copy Block`）必须红。
- **New tab 行**：当前只有 1 个 tab 时，`New tab` 行仍然可点（`aria-disabled=false`）→
  对旧实现（没有这一行）必须红。
- **行容器结构**：行容器 `tagName === "DIV"` 且 `role === "button"`，行内恰好 2 个 `<button>` →
  对旧实现（整行 `<button>` + 0 个内层按钮）必须红。
- **点行体 = Move / 点 ⧉ = Copy**：同一行两种点击产出两次不同调用
  （`MoveBlockToTab` vs `CopyBlockToTab`）→ 对旧实现（只有一种动作）必须红。
- **图标可达性**：两个图标按钮 `title` 与 `aria-label` 均非空 →
  对旧实现（没有图标按钮）必须红。
- **入口覆盖守卫**：`makeBlockMoveMenuItems()` 对任意非 preview block 都返回非空数组
  （不依赖 view 类型）→ 这是防「只有 agent 块有」的回归锁。

## G1 签字

- [ ] nita 确认「做什么 / 不做什么 / 验收判据」三段
