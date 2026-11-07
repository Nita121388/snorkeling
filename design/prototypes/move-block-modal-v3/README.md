# Move Block to Tab — 菜单 4 条 → 1 条，弹窗内「选择 / 新建」，每行两个图标动作

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/block/blockframe-header.tsx, frontend/app/tab/tab-target-modal.tsx, frontend/app/tab/tab.scss, frontend/app/element/flyoutmenu.scss, frontend/app/modals/modal.tsx, frontend/app/modals/modal.scss
> 最后同步：2026-11-06

## 需求（nita 2026-11-06）

> 「Move Block to Tab 这个功能我觉得不需要那么多菜单，用户选择 Move 后，支持选择和新建就行。
> 而且现在只支持 agent Block，我觉得不合理。」

拆成两条：

- **R1 菜单收敛**：block 右键 / `⋯` 菜单里的 4 条（Move to New Tab / Move to Existing Tab... /
  Copy to New Tab / Copy to Existing Tab...）收敛成 **1 条 `Move to Tab…`**，打开弹窗后
  同时提供「选已有 tab」和「建新 tab」。
- **R2 全 block 覆盖**：不再只有 agent 块（实际是只有接过 `appendBlockMoveMenuItems` 的视图）
  才看得到入口。

## 现状（真实代码，2026-11-06 核对）

菜单侧 `blockframe-header.tsx` → `makeBlockMoveMenuItems()` 产出 4 条：

| 菜单项 | 行为 | 问题 |
|---|---|---|
| `Move to New Tab` | 直接 `MoveBlockToNewTab(blockId, sourceTabName)`，无确认 | 名字不可见、不可控 |
| `Move to Existing Tab...` | 开 `TabTargetModal`（`mode="move"`） | 弹窗内**不能新建** |
| `Copy to New Tab` | 直接 `CopyBlockToNewTab(...)` | 同上 |
| `Copy to Existing Tab...` | 开 `TabTargetModal`（`mode="copy"`） | 同上 |

> 「新建」和「选择」被拆成两条菜单 —— 菜单多是**结果**，根因是这两件事没有同一个落点。

弹窗侧 `tab-target-modal.tsx` / `TabTargetRow`：
- 只列 `workspace.tabids` 里除当前 tab 之外的 tab，无「新建」行；
- 空态文案 `No other tabs`；
- 行内 `hover`：静态 `.tab-target-action-label` → `.tab-target-action-btn`（accent 实色，**只有一个动作**）；
  `working` 换 `.tab-target-spinner`；`disabled` 整行 0.55 透明；
- 行容器是 `<button>` —— 所以**不能**直接往里加两个图标按钮（非法嵌套，见 `overview-board.tsx:141`）。

覆盖面（为什么「看起来只支持 agent Block」）：

| 入口 | 现状 |
|---|---|
| Block header `⋯` | 全 block（`makeBlockMoveMenuItems` 对任意 `!preview && !ephemeral` 生效） |
| Block 框右键 | 全 block，但 `.block-content` 内提前 return |
| `view/term`（含 agent） | ✅ 接了 `appendBlockMoveMenuItems` |
| `view/vcs` / `preview-directory` / `preview-explorer` / `processviewer` | ✅ 已接 |
| `view/preview-model`（markdown / 图片 / webview） | ❌ 未接 |
| `view/aisessions` / `codeeditor` / `tsunami` … | ❌ 未接 |

结论：**不是按 block 类型拦的，是按「谁记得接」漏的**。agent / 普通终端都走 term.tsx 那条路，
所以看起来「只有 agent 有」；markdown 预览里右键就真的没有。

## 设计决策

| # | 决策 | 理由 |
|---|---|---|
| 1 | 菜单 4 → **1 条** `Move to Tab…` | 「去哪个 tab」和「要不要新建」是同一个问题的两个答案，不该在菜单层先分叉 |
| 2 | **New tab 行置顶**且永远 enabled | 没有其它 tab 时它就是唯一可点行，不需要第二条菜单兜底；`canMoveToExistingTab=false` 不再需要「置灰两条」这种表达 |
| 3 | Copy **保留为每行的 `⧉` 图标**，**不做模式切换** | 复制会话块到别的 tab 是真实用法，但不值得再占一条菜单；做成「先选模式再选目标」反而多一步心理建模 |
| 3b | 行体点击 = **Move**（`→` 是它的显式 / 键盘可达 affordance） | 保留「点一下就走」的快路径；只允许点图标会让每行都变两步 |
| 3c | 行容器由 `<button>` 改 `div[role=button]` | 往按钮里塞两个按钮是非法嵌套，点击会串（`overview-board.tsx:141` 已踩过） |
| 4 | New tab **不输名字**，后端沿用源 tab 名 + 去重 | 保持一次点击完成；改名走已有 tab 重命名 |
| 5 | footer 只留 `Cancel` | 动作发生在行点击，不需要 OK 二次确认 |
| 6 | `TabTargetModal` 的新增全部**可选 prop** | `widgets.tsx` 的 Create 弹窗也用它，不传 = 行为与今天完全一致 |
| 7 | `⋯` 菜单作为**保底入口**，不依赖 view 接力 | 现状漏 4 个视图，以后还会漂；先保证「任何 block 的 ⋯ 里都有」，再逐个补视图右键 |

## 原型内容

```bash
start design/prototypes/move-block-modal-v3/index.html
```

| 章节 | 内容 |
|---|---|
| 0 | 决策表（菜单条数 / Copy 去留 / New tab 命名） |
| 1 | **菜单层对照**：现状 4 条 vs 新版 1 条，都是真实 `.menu` / `.menu-item` 样式，hover 生效 |
| 2 | **新弹窗（可交互）**：hover 任意行看两个图标浮现；点行体 = Move，点 `⧉` = Copy；点 `New tab` 看建 tab 反馈 + spinner |
| 3 | 空态两种画法：保留 `No other tabs` / 隐藏分隔线 |
| 4 | 覆盖面表：哪些视图现在右键没有 Move，为什么看起来「只有 agent Block」 |
| 5 | 落地要点（按文件列改什么） |
| 6 | 待拍板三件事 + 建议 |

右上角 Dark / Light 切换 = 真实 `theme.scss` 的 `--accent-color` / `--action-bg-color` /
`--modal-bg-color` / `--overlay-bg-color`，浅色是米黄主题的紫 accent。

## 原型自检（机器判定，不是「看了一眼」）

```bash
node design/prototypes/move-block-modal-v3/selfcheck.mjs     # 期望 20/20，出口 0
```

把 `index.html` 装进真实 Chromium（Edge `--headless=new`）跑 CDP 断言，复用
`scripts/verify/lib/cdp.mjs`（不自造第二份 client）。出口 `0` 全绿 / `1` 断言失败 / `2` 环境错误。
截图证据落 `verify-runs/prototype-move-block-modal-v3/`（gitignore）。

| # | 断言 |
|---|---|
| 1-3 | New tab 行是列表首行、`aria-disabled=false`、文案 `New tab` + `Named after «源 tab»` |
| 4-6 | 行容器是 `div[role=button]`（非 `<button>`）、正好两个图标 `move`/`copy`、两个图标都写了 `title` + `aria-label` |
| 7 | 列表顺序 `newtab → divider → tab,tab,tab` |
| 8-9 | **无模式切换控件**（无 seg / 无 mode 按钮）、标题固定 `Move Block` |
| 10-11 | 现状菜单 4 条 `Move/Copy to …`；新菜单 1 条 `Move to Tab…` |
| 12 | 点行体 → Move 到该 tab |
| 13 | 点 `⧉` → Copy 到该 tab（同一个行、不同动作、无模式切换） |
| 14-16 | 点 New tab 的 `→` → 行 `is-working` + 被点图标换 spinner + 其它行 `aria-disabled=true` + 两个图标都 disabled |
| 17-18 | toast 出现、working 结束两个图标都回来（`iconActs` 恢复成 `["move","copy"]`） |
| 19 | 未 hover 时 `.row-icons` `opacity=0`（零噪音） |
| 20-21 | **真实指针** hover → `opacity=1`；指针移开 → 回 `0` |
| 22-23 | 主题切换改 `body[data-theme]` 且 modal 底色变 |
| 24-25 | 弹窗宽 420px（真实壳宽度）、列表宽受控不溢出 |

## 落地要点

| 文件 | 改什么 |
|---|---|
| `blockframe-header.tsx` | `makeBlockMoveMenuItems` 4 → 1 条；删掉两个 `Move/Copy to New Tab` 分支 |
| `blockframe-header.tsx` | `MoveBlockToTabModal`：**删掉 `mode` prop**，改成每行两个动作回调；新增 `onCreateTab(kind)` |
| `tab-target-modal.tsx` | `TabTargetRow` 由 `<button>` 改 `div[role=button]`（否则图标按钮非法嵌套）；新增可选 `onCreate?` / `createHint?` / `rowActions?`；不传则行为不变 |
| `tab.scss` | 新增 `.new-tab-row`（`.plus-box` 虚线→hover 实心）、`.list-divider`、`.row-icons` + `.row-icon-btn`（hover / `focus-visible` 浮现）；删 `.tab-target-action*` |
| `preview-model.tsx` / `aisessions.tsx` / `editor` 等 | 右键菜单补 `appendBlockMoveMenuItems` |

## 验收（落地阶段的判据草案）

- `npx vitest run frontend/app/tab/ frontend/app/block/` → 基线 +新增全绿
- 新增单测：`makeBlockMoveMenuItems()` 对任意 block 返回 **1** 条 `Move to Tab…`（防回退）
- 新增单测：`TabTargetModal` 不传 `onCreate` 时**不渲染** New tab 行（保 `widgets.tsx` 行为）
- 真机：agent block / 普通 term block / markdown 预览块的 `⋯` 菜单**都**有 `Move to Tab…`；
  弹窗 New tab 行可点，建出的 tab 名为源 tab 名 + 去重序号

## 待拍板

1. **Copy 怎么放** —— ① 每行两个图标（本原型推荐）／② 弹窗 header 分段控件（先选模式再选目标）／③ 菜单保留两条 Move/Copy 入口／④ 直接砍掉
1b. **行体点击做什么** —— ① 行体 = Move（本原型推荐，`→` 是显式 affordance）／② 行体不做事，只允许点图标（每行变两步）
2. **New tab 名字** —— ① 自动派生（推荐）／② 点行后就地展开输入框
3. **空态文案** —— ① 保留 `No other tabs`（推荐）／② 隐藏分隔线只留 New tab 行
