# 技术设计：Overview 看板卡片跨列移动动画

> **基线变更（2026-11-06 10:30）**：本任务最初设计基于 commit `ec327a59` 的看板结构（
> `blocks` + `groupBlocksByStatus` + 每卡 `<button>`）。当时未拉取 `origin/main`，
> 上游已有 41 个提交（含 `看板 v2`：卡片信息架构、5 列常显、三分组、时间线视图）。
> 现已合并 `origin/main`，以下内容已按 v2 结构重写（`cards` + `groupOverviewCards` +
> 每卡 `div[role=button]` + `column.key` 列键）。

## 1. 为什么是 FLIP 而不是 CSS transition / View Transitions

看板的 DOM 结构决定了「换列」= 旧列卸载 + 新列挂载：

```tsx
columns.map((column) => (
  <section key={column.status}>
    {column.blocks.map((block) => <BoardCard key={block.blockId} ... />)}
  </section>
))
```

`key` 只在同一父节点内生效，React 不会把节点搬到另一个 `<section>`，所以：

- CSS `transition: all` → 起点是新位置，表现为瞬移（no-op）。
- View Transitions API 可用（Chromium 136 / Electron 41），但需要把状态提交包进 `document.startViewTransition(() => flushSync(...))`。
  看板的状态源在 `session-overview.tsx` 的 Jotai atom / 轮询订阅里，包进去意味着把整个 overview 面板（含虚拟列表、滚动容器）卷进全局快照，
  `now` 定时器每次 tick 都会拍快照。**耦合成本 > 动效收益**，不采用。
- FLIP：动效完全限制在 `OverviewBoard` 子树内，只依赖一次 `getBoundingClientRect()` 采样 + WAAPI，零外部耦合，且能拆出纯函数做单测。

## 2. 数据模型与纯函数边界

新增 `overview-board-motion.ts`，遵循仓内既有惯例（`overview-board-model.ts` / `preview-text-modes.ts`：逻辑纯函数化 + vitest 直测，不 import React、不碰 DOM）。

```ts
export type BoardRect = { left: number; top: number; width: number; height: number };
export type BoardSnapshotItem = { rect: BoardRect; status: string };

export type BoardSnapshot = {
    containerWidth: number;
    /** 列 key 列表（`status:working` / `tab:<id>` / `provider:<name>`）—— 用来识别分组口径切换。 */
    columns: readonly string[];
    items: Record<string, BoardSnapshotItem>; // key = blockId
};

export type BoardMotionKind = "move" | "reflow" | "enter";
export type BoardMovement = { blockId: string; kind: BoardMotionKind; dx: number; dy: number };

export const BoardMotionDefaults = {
    minDeltaPx: 1.5,   // S4
    maxAxisRatio: 1.5, // S3
    maxMoves: 12,      // S6
};

export function diffBoardLayout(
    prev: BoardSnapshot | null,
    next: BoardSnapshot,
    opts: BoardMotionOptions
): BoardMovement[];
```

`diffBoardLayout` 的判定顺序（顺序即语义，不可调）：

1. `prev == null` → `[]`（S1 由调用侧的 `armed` 兜底，这里再兜一层）。
2. `prev.containerWidth !== next.containerWidth` → `[]`（S2）。
3. **`columns` 集合不等** → `[]`（**S7：分组口径切换**）。
   v2 新增 status / tab / provider 三分组：切换时所有卡片的列 key 全变，
   按普通规则会「满屏飞行」。这是布局切换，必须整体静默。集合比较与顺序无关
   （列重排不算切换）。
4. 遍历 `next.items`：
   - 不在 `prev.items` → `{ kind: "enter", dx: 0, dy: 0 }`。
   - `dx/dy` 都小于 `minDeltaPx` → 跳过。
   - 单轴位移超 `maxAxisRatio` × 视口 → 跳过（S3）。
   - `status`（= 列 key）不同 → `kind: "move"`。
   - 其余 → `kind: "reflow"`。
5. 按 `kind` 排序（`move` 优先），对 `move` 超额部分截断为 `reflow`，而非直接丢弃 ——
   数量上限只降级不丢动效，避免「有的飞有的跳」的割裂感。

纯函数保证：输入相同 → 输出相同；不读 `window`、不读 `matchMedia`
（reduced-motion 由调用侧处理，见 §5）。

## 3. 组件接线（`overview-board.tsx`）

```
containerRef ──┬─ data-board-block-id 标注每张卡
               └─ useLayoutEffect 采样 → diff → 播放
```

关键实现点：

```tsx
const containerRef = useRef<HTMLDivElement | null>(null);
const prevSnapshotRef = useRef<BoardSnapshot | null>(null);
const armedRef = useRef(false);

useLayoutEffect(() => {
    const container = containerRef.current;
    if (container == null) return;

    // 1) 先读全部：此时 DOM 上没有任何 transform 残留（上一轮已在动画结束后自然归位）。
    const cards = container.querySelectorAll<HTMLElement>("[data-board-block-id]");
    const items: Record<string, BoardSnapshotItem> = {};
    for (const el of cards) {
        const id = el.dataset.boardBlockId;
        if (!id) continue;
        const r = el.getBoundingClientRect();
        items[id] = {
            rect: { left: r.left, top: r.top, width: r.width, height: r.height },
            status: el.dataset.boardStatus ?? "",
        };
    }
    const next: BoardSnapshot = { containerWidth: container.clientWidth, items };

    // 2) 首帧只记账（S1）
    if (!armedRef.current) {
        armedRef.current = true;
        prevSnapshotRef.current = next;
        return;
    }

    const prev = prevSnapshotRef.current;
    prevSnapshotRef.current = next;
    if (prev == null) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true; // S5
    if (reduced) return;

    const movements = diffBoardLayout(prev, next, {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
    });
    if (movements.length === 0) return;

    // 3) 再写全部：先 cancel 掉残留动画（S6 幂等）
    for (const m of movements) { /* 找到 el，cancel，play */ }
}, [/* 依赖见下 */]);
```

依赖：`[blocks, presentedStatuses, maxTotal]` 的稳定签名 —— 用 `columns` 本身不可行（每次渲染新数组），
改为依赖 `blockId + 归一化状态的拼接字符串`（`useMemo` 得到的 `layoutSignature`）。这样：

- `now` tick（预览/相对时间变化）→ 签名不变 → effect 不跑 → 零开销。
- 状态变化 / 过滤变化 / 截断变化 → 签名变 → effect 跑 → 采样 + diff。

`data-board-status` 用归一化后的列状态（`column.status`），保证「同一列内换位置」不会被误判成 `move`。

## 4. 动效参数

| 层 | 触发 | 关键帧 | 时长 | 缓动 |
|---|---|---|---|---|
| L1 move | 状态列变化 | `translate(dx,dy) scale(.97) opacity .6` → `none / 1` | 260ms | `cubic-bezier(.2,.9,.16,1)` |
| L2 reflow | 仅位置被挤动 | `translate(dx,dy)` → `none` | 160ms | 同上 |
| L3 enter | 快照中新增 | `opacity 0→1` + `translateY(6px)→0` + `scale(.98)→1` | 180ms | 同上 |
| L4 count | `column-count` 值变化 | `scale(1→1.16→1)` | 220ms | `ease-out` |
| L1 落点 dot | 目标列收到 `move` | `box-shadow 0 → 0 0 0 6px <status 色 18%> → 0` | 700ms | `ease-out` |

L1 飞行期间：`el.classList.add("is-flying")`，动画 `finished` 后移除（`finally` 也要清，避免中断残留）。

L4 与 L1 落点 dot 用 **CSS animation + key 变化** 驱动（不给计数徽章加 WAAPI，避免采样逻辑变复杂）：

- 计数徽章：`<span key={column.blocks.length}>` 强制重建 → 动画自然重播。仅当 `armed` 为真时启用（首帧不播）。
- 落点 dot：`landingStatus` 存在性由 effect 驱动，`setState` 一个 `landingTick`（`{status, n}`），
  `key={`${status}-${landingTick.n}`}` 触发重播，`animationend` 或 700ms 后清空。

## 5. `prefers-reduced-motion`

- JS 侧：effect 内 `matchMedia` 直接 return（动都不动，无需 duration 0）。
- CSS 侧：`@media (prefers-reduced-motion: reduce)` 覆盖 L4 / dot 光晕的 `animation: none`。
- 与 `frontend/app/element/info-card/info-card.scss:202` 的既有写法保持一致（那里也是纯 CSS 兜底）。

## 6. 性能与风险

| 风险 | 处理 |
|---|---|
| 每秒 `now` tick 触发采样 | `layoutSignature` 依赖把 tick 挡在 effect 外 |
| 一次过滤变更导致 40 张卡全动 | S6：只飞前 12，其余降级 reflow |
| 读取 rect 触发布局抖动（layout thrash） | 严格「先全读、后全写」两段式，读阶段不写任何 style |
| 动画与 `overflow-y: auto` 列滚动打架 | `transform` 不改变滚动尺寸；飞行中不设置 `position: fixed`，用 `z-index` 提升即可 |
| 列被整列隐藏导致其余列横移 | 走 L2 短动效；隐藏列本身瞬删（已知限制，见 prd「不做什么」） |
| 卡片 hover 背景过渡与 FLIP 冲突 | hover 过渡只作用 `background-color/border-color`，与 `transform` 互不干扰 |
| 与 `11-06-overview-board-card-actions` 同文件冲突 | 见 §7 |

## 7. 与 card-actions 包的落地顺序

`11-06-overview-board-card-actions` 要把卡片外层的 `<button>` 改成 `div[role=button]` + 内部动作按钮，
并给首行加动作区。它与本包共用 `overview-board.tsx`。

约定：

- **本包不预设 card-actions 的结构**，只要求「每张卡的最外层元素挂 `data-board-block-id` 与 `data-board-status`」。
- 若 card-actions 后落地：它需要保留这两个 data 属性（写进它的实现约束）。
- 若 card-actions 先落地：本包 effect 的选择器不变（`[data-board-block-id]`），只是被测元素从 `<button>` 变成 `<div>`；
  单测不受影响（纯函数），verify 脚本里 `.session-overview-board-card` 选择器不变。

## 8. 回滚

- 纯前端、单文件开关：`overview-board-motion.ts` 顶部 `export const OVERVIEW_BOARD_MOTION_ENABLED = true`，
  改 `false` → effect 直接 return，看板退回当前瞬移行为（与 `OVERVIEW_BOARD_ENABLED` 同一惯例）。
- 无数据/接口/迁移，回滚零风险。
