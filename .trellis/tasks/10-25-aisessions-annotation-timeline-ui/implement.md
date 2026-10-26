# Implement — 批注时间线 Rail 视觉重构 + 弹窗去透明

> 父任务：`10-25-aisessions-annotation-timeline`。子任务：`10-25-aisessions-annotation-timeline-ui`。
> 蓝图见 `design.md`。本文件是执行步骤，对应 design §2（圆点）/ §3（去透明）。

## 决策（已与 YG 确认）

1. **分布模式**：两态自适应（节点少→按 seq 等比铺满全高；节点多→固定 28px 槽 + rail 内滚动）。
2. **展开宽度**：44px（`AnnotationRailExpandedWidth` 36→44）。
3. **右侧 `#seq` 标签**：不常显，仅 hover/active 的悬浮卡内显示。
4. **去透明范围**：悬浮卡 `AnnotationCard` 强制实色；编辑器 Modal 本体本就实色（不重复处理）。状态徽标（draft/orphan/warning 等轻 alpha 色块）按 design §3 保留——它不是弹窗背景。

## 步骤

- [x] 1. `annotation-model.ts`：
  - `AnnotationRailExpandedWidth` 36 → 44；`AnnotationRailCollapsedWidth` 16 保持（仅竖线）。
  - 新增常量：`RailDotRestingSize = 10`、`RailDotActiveSize = 16`、`RailDotGap = 28`（design `RailMinDotGap`）、`RailAxisWidth = 2`。
  - 新增 `buildSeqRanks(items)`：按 `seq` 升序给出每项的 `rank` 与 `maxRank`（无重复时 `rank=i`，`maxRank=n-1`），供 rail 等比映射 `top = rank/(maxRank) * fullHeight`。
  - `clusterRailItems` 不变（仍是多节点滚动分支的入口），但 rail 改用新的两态分支（见步骤 3）。

- [x] 2. `annotation-rail.tsx`：
  - **移除** `import { tickMagnification } from "@/app/view/session-outline-rail"`（design 要求不复用药丸语言）。删除 `RestingPillWidth/MagnifiedPillWidth/RestingPillHeight/MagnifiedPillHeight` 与 `MagnifyRadius` 常量。
  - 圆点组件：`<span>` 用 `rounded-full`（直径 resting 10 / active 16，`transition` 150ms ease-out），三态 class：
    - accepted 实心：`bg-primary`
    - draft 空心环：`border border-accent bg-transparent`
    - orphan 实心警告：`bg-warning`
    - active（=`activeSeq` 命中）：`scale` 1.6 + 外圈 `ring-2 ring-accent`（doT 放大用 `transform` 而非改宽高，避免布局抖动）。
  - **竖轴**：rail 内一条 `absolute left-1/2 -translate-x-1/2 w-px bg-border/40`（2px 用 `w-0.5`）贯穿全高；无批注时不画轴、只留折叠竖线（沿用既有空态）。
  - **两态分布**：
    - 用 `ResizeObserver` 量 rail 内容区高度 `containerH`。
    - 节点少（`items 间距 >= RailDotGap` 即 `containerH/(n-1) >= RailDotGap`）：每点 `top = (rank/maxRank)*containerH`，自然铺满。
    - 节点多：固定 `RailDotGap` 间距，容器 `overflow-y-auto`。
    - 两条分支共用同一圆点组件 + pin 逻辑。
  - 展开/折叠：折叠仍 16px 只画竖线；展开 44px；偏好 `localStorage` 沿用 `collapsed`。
  - hover/active 出卡逻辑、pin 逻辑、空态生成入口**全部保留**（design §2.3）。

- [x] 3. `annotation-card.tsx`：背景强制实色去透明：
  - 容器 `bg-modalbg` 已实色，确认**无** `bg-*/20`、`/30`、`backdrop-blur`；移除任何半透明边框——`border border-border`（无 `/alpha`）。
  - 内部每一条批注块 `bg-surface` → 改为 `bg-modalbg`（或 `bg-panel` 实色）；`border-border/70` → `border-border`。
  - 状态徽标（`bg-accent/15`、`bg-accent/10`、`border-accent/60`）按决策 4 **保留**（语义色块，非弹窗背景）。
  - `pinned` 徽标 `bg-accent/15` 保留。

- [x] 4. `annotation-rail.dom.test.tsx` 更新：
  - 断言圆点渲染：accepted → `bg-primary`；draft → `border-accent`；orphan → `bg-warning`（选 `cluster.hasOrphan` 的簇验证）。
  - 断言**不再**出现 `tickMagnification` 相关药丸（`rounded-full` 圆点存在、`rounded-md` 横条不再）。
  - pin/Accept/Discard 可达性断言**保持原样**（不应因重构失效）。

- [ ] 5. 校验：
  - `npx vitest run frontend/app/view/aisessions`（全绿）
  - `npx tsc --noEmit -p tsconfig.json`（仅前端）
  - 启动 app（CDP 9222）肉眼确认：rail 为圆点 + 竖轴、展开 44px、密集会话走滚动、悬浮卡实色不透底。

## 回滚点

- 步骤 1–2 改 model+rail：若两态分布抖动，回退 rail 分支、保留圆点 class。
- 步骤 3 纯样式：回退 `annotation-card.tsx` 一行即可。
- 步骤 4 测试：回退断言。

## 验收（design §5 + PRD）

- 圆点三态（accepted/draft/orphan）形状 + 颜色正确。
- 点击圆点 pin 卡片，Accept/Discard 可达（沿用 74430cbb）。
- >2000 消息会话：rail 滚动/hover/跳转无卡顿。
- 折叠区目标能展开后跳。
- 关闭详情再打开批注照常显示。
- orphan 黄条 + 重指定/删除不静默消失。
- `vitest` 全绿、`tsc` 干净。
