> **Confirmed: 2026-11-06 @nita**

# Overview 看板卡片跨列移动动画（FLIP + WAAPI）

## Goal

Overview 看板（`viewMode === "board"`）里，一张卡片的状态发生变化后会从一列「瞬移」到另一列：旧列的 DOM 卸载、新列的 DOM 新建，视觉上是一帧硬跳。
本次要给这条链路加动效：**卡片平滑飞入新列侧**，同时让被挤动的邻居卡片、新出现的卡片、列头计数都有匹配的小动作；并在首次挂载、resize、切换视图、多卡同时变动等场景下**保持安静**，不制造新的闪烁。

## 背景与约束

- 看板渲染结构：`groupBlocksByStatus()` 把 blockId 分到 5 个状态列，每列各自 `column.blocks.map()` 渲染卡片。
  **跨列 = 卸载 + 挂载**，纯 CSS `transition` 拿不到起点，必须做 FLIP（First-Last-Invert-Play）。
- 项目无现成 FLIP 工具，也没有 `startViewTransition` 使用先例。
- 卡片是 `<button>`，动效用 `transform` / `opacity` 即可，不能改 `width/height`（会触发列内重排）。
- 每列自带 `overflow-y: auto` 独立滚动，卡片的 `transform` 相对自身布局位，视口坐标算 delta 可用。

## 做什么

### R1 跨列飞行（L1）

- 触发条件：该 blockId 的**归一化状态列**与上一帧不同（`normalizeOverviewBoardStatus` 结果变化）。
- 起点 = 上一帧该卡片在旧列的 `getBoundingClientRect()`；落点 = 新列内的最终位置。
- 关键帧：`translate(dx,dy) scale(0.97) opacity 0.6` → `translate(0,0) scale(1) opacity 1`。
- 飞行期间卡片 `z-index` 抬高（视觉上是「一张卡飞过去」，不是「两张卡交叉」）。
- 落点列头状态 dot 播放一圈光晕（700ms），指示落点。

### R2 回流轻推（L2）

- 触发条件：状态没变，但位置被挤动（上面的卡飞走、某列被隐藏导致整体横移）。
- 只 `translate`，**不**做缩放与透明度；时长明显短于 L1，避免和 L1 抢注意力。

### R3 新卡入场（L3）

- 触发条件：上一帧快照里没有该 blockId（首次出现 / 被 `maxTotal` 截断后挤回可见范围）。
- 关键帧：`opacity 0→1` + `translateY(6px)→0` + `scale(0.98)→1`。

### R4 列头计数联动（L4）

- `column-count` 数值变化时做一次 `scale(1 → 1.16 → 1)` 弹跳，让「数字变了」被看见。

### R5 安静规则（动效不得破坏现有体验）

以下 6 种情况必须**不播放**或**降级**：

- S1 **首次挂载**：`armed` 标志，第一次布局采样只记录不播放（否则 list→board 切换满屏乱飞）。
- S2 **容器宽度变化**：快照携带 `containerWidth`，前后不等 → 判为 resize，全部直接落位。
- S3 **单轴位移超阈值**：`|dx|` 或 `|dy|` 大于 1.5×对应视口尺寸 → 判为布局重排，跳过。
- S4 **亚像素位移**：`|dx| + |dy| < 1.5px` → 不动。
- S5 **`prefers-reduced-motion: reduce`**：所有时长归零（直接落位），计数与光晕也不播动画。
- S6 **同时飞行上限**：一帧内需要飞行的卡片超过 12 张时，只让前 12 张飞，其余直接落位（过滤条件大改时防掉帧）。

### R6 幂等与可重入

- 同一元素重复触发前先 `getAnimations().forEach(a => a.cancel())`，不叠加。
- 采样顺序固定：**先批量读完全部 rect，再批量 animate**（中途读会读到被 transform 污染的坐标）。
- **飞行中的卡片不采信 `getBoundingClientRect()`**：它返回的是合成后的插值坐标，会把「落点」记成半路位置，导致同一张卡被重复判定为移动。对仍有 `getAnimations()` 的元素复用上一帧记录的布局 rect（即它将落定的位置）。
- `now` 定时器每次 tick 引起的重渲染不得触发任何动画（布局签名不变，天然满足）。

## 不做什么

- 不做退场 ghost 动画（卡片已卸载，需 fixed 覆盖层 + 位置同步，收益不抵复杂度）。
- 不改 `groupBlocksByStatus` 的分组/列顺序/截断语义。
- 不改 `overview-board-model.ts` 的视图模式持久化。
- 不动 `session-overview.tsx`（看板自包含，props 不变）。
- 不做拖拽换列、不做列表视图动画、不做列排序动画。
- 不与 `11-06-overview-board-card-actions` 合并：那包也在改 `overview-board.tsx`（卡片动作区）。
  本包实现时该包仍处 planning、代码未落地；两者落地顺序为 **card-actions 先、motion 后**，
  若 card-actions 先合并，本包需要在新结构上重新对齐 `data-board-block-id` 的挂载点（见 design §7）。

## 验收判据

- [ ] `npx vitest run frontend/app/session-overview/overview-board-motion.test.ts` → `10 passed`
- [ ] `npx vitest run frontend/app/session-overview/` → `70 passed`（既有 60 + 新增 10）
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `69`（改动前基线）
- [ ] CDP 真机：改一个卡片状态后 110ms 采样的 `rect.left` **既不等于**旧列 x **也不等于**新列 x，且落在两者之间；400ms 后动画结束（`getAnimations()` 归零、无 `is-flying`）
- [ ] CDP 真机：`list → board` 首次切换后 120ms 内 `is-flying` 卡片数为 0
- [ ] 台账 `docs/project/verify-ledger.md` 补一行结论

真机命令：`node scripts/verify/overview-board/verify.mjs --expect=motion`（自动起隔离 Electron 实例，跑完自关）。
