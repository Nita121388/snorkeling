# Overview 看板卡片动作：关闭 / 删除（含彻底删除）+ 内联 Tab 组不被误删

## Goal

Overview 看板的 agent 卡片目前只能「点击打开会话详情」，没有任何关闭/删除入口；而列表视图早就有 ×（关 block）与垃圾桶（删会话文件）。
同时现有 `deleteOverviewBlock()` 对非 static tab 直接 `layoutModel.closeNode(node.id)`，当该 block 处于**内联 Tab 组**（一个 node 里挂多个 block）时会把**整组兄弟 block 一起拆掉**。
本次要让看板卡片具备「关闭 / 删除」两个动作（删除二次确认，并提供**彻底删除**），并保证任何时刻**只作用于卡片对应的那一个 block**。

## 做什么

### R1 卡片动作入口

- 看板卡片首行右侧提供动作区：`×`（关闭）、`🗑`（删除）。
- 动作区默认 `opacity: 0`，卡片 `hover` 或 `focus-within` 时可见；**始终占位**，不产生布局跳动、不压标题省略号。
- 无 `sessionId` 的卡片（普通 term block）只给 `×`，不给 `🗑`。
- 点击卡片本体 = 打开 Session Detail（现有行为不变）；动作按钮必须 `stopPropagation`。
- 键盘可达：卡片改用 `div[role=button]` + `tabIndex=0`（Enter/Space 打开详情），`event.target === currentTarget` 才响应，避免子按钮冒泡触发。

### R2 关闭（×）

- 语义 = 关闭这一个 block（会话文件保留，可从 Sessions 列表重新打开）。
- 实现统一走 `layoutModel.closeBlock(blockId)`（内部已处理内联 Tab 组：`removeBlockIdFromInlineTabNode` + commit + `onNodeDelete`），static tab 走 `uxCloseBlock`；**禁止**再对单 block 使用 `closeNode(node.id)`。
- 关闭不需要二次确认（与列表视图一致）；不新增 `working` 状态的额外确认。

### R3 删除（🗑）：软删 + 彻底删除，二次确认

- 点击 `🗑` 弹出确认对话框（复用 `ConfirmModal`），对话框提供三个出口：
  - 主（红 destructive）：**彻底删除** —— 永久删除会话文件，不可恢复
  - 次（灰）：**移到回收站** —— 现有软删语义（移动到 `~/.snorkeling/ai-sessions/deleted`）
  - 取消
- 「一次点击开框 + 框内再点一次确认」构成二次确认；两个出口都显式，不允许默认落在不可恢复的那一侧。
- 彻底删除需要**后端硬删能力**：`Manager` 新增永久删除路径（删源文件 + 清理 sqlite 元数据 / 附属表），经 `aisessions` 服务新方法暴露给前端（生成 TS 绑定）。
- 删除成功后仅关闭该 block 并刷新看板；删除中该卡片进入忙碌态（动作禁用 + 降透明度），错误落到现有 `.session-overview-error` 行。
- 列表视图的垃圾桶动作改为复用同一确认对话框（不再用 `window.confirm`），保证跨面一致。

### R4 内联 Tab 组安全（不变量）

关闭/删除一个 block 时，必须满足：

- I1 同 tab 内其它 block 的卡片数量只在「被操作的那一张」上减 1，兄弟 block 一张不少。
- I2 关闭后 workspace tab 数量不变（除非该 tab 只有被关的那一个 block）。
- I3 被关的是内联 Tab 组的活动 block 时，组内自动切到兄弟 block，组不会变空。
- I4 彻底删除 / 移到回收站同样只影响该 block，不连带兄弟 block 与其它 tab。
- I5 任何下游副作用（`onNodeDelete` / `ObjectService.DeleteBlock`）只对单个 blockId 生效。

### R5 硬删的数据一致性

彻底删除后：会话不出现在列表/看板，`deleted/` 目录不留副本，相关元数据行（会话 meta、注解、props、审计）不残留孤儿。

## 不做什么

- 不做「仅从看板隐藏卡片」的第三套可见性状态。
- 不做撤销/回收站管理界面（软删副本仍靠手工搬回，与现状一致）。
- 不改看板分组/列顺序/视图切换逻辑，不改 `groupBlocksByStatus` 行为。
- 不在本包收敛 `Modal`/`FlexiModal` 两套弹窗壳（那是 `11-02-modal-single-shell-refactor`）。
- 不改会话列表视图的其它动作（恢复/继续/标题编辑等）。
- 不做批量关闭/批量删除。
- 不为 `working` 状态新增「关闭会话会终止 agent」的额外确认（登记为后续独立需求）。

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/` → `60 passed`（基线 50 + 新增 10）
- [ ] `npx vitest run frontend/app/modals/confirmmodal.test.tsx` → `6 passed`（基线 4 + 新增 2）
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". ./scripts/use-local-env.ps1 -Quiet; go test ./pkg/aisessions -run Delete"` → `ok`
- [ ] `node scripts/verify/overview-board/actions.mjs --attach` → `12/12`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `69`（既有基线，不涨）

新增判据必须能看见本包的缺陷：

- 器具（`scripts/verify/overview-board/actions.mjs`）在**修复前**必须转红：内联 Tab 组场景点 `×` 后兄弟 block 消失（I1/I3 失败）、`🗑` 无确认框、无彻底删除入口。
- 单测层新增纯函数 `planBlockRemoval()`（多 block node → `closeBlock`；单 block → `closeNode`；static tab → `uxCloseBlock`；node 缺失 → `DeleteBlock`），对旧实现（直接 `closeNode`）必须红。

## G1 签字

- [ ] nita 确认「做什么 / 不做什么 / 验收判据」三段
