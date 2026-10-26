# 批注时间线 Rail 视觉重构 + 弹窗去透明

> 父任务：`10-25-aisessions-annotation-timeline`。子任务：`10-25-aisessions-annotation-timeline-ui`。
> 本设计**只改前端展示层**，不动存储 / RPC / 覆盖规则。

## 1. 问题

当前 `AnnotationRail` 复用了 `session-outline-rail` 的「横向药丸」语言：
- 节点是 10–26px 宽、2–3px 高的**横条**，8px 一槽，自上而下挤在 rail 顶部；
- 和信息条 outline-rail 的波浪药丸是**同一套视觉**，用户无法一眼区分「批注轴」与「消息大纲」；
- 用户需求：时间线要**舒展、垂直铺满、间隔拉大、用圆点作节点**，不要和信息条同款药丸。

## 2. 目标视觉

```
消息流                    ║
─────────────            ●  #3    accepted   (实心圆点 + 右标签)
                         │
                         │
                         ○  #12   draft      (空心环)
                         │
                         │
                         ●  #20   accepted · active (放大 + 外圈光环)
                         │
                         │
                         ▲  #35   orphan     (警告色实心)
                         │
                         │
                         ●  #48   accepted
                         ║
        (2px 竖轴贯穿全高，圆点按 seq 在轴上分布)
```

### 2.1 节点 = 圆点，不是药丸

| 状态 | 形状 | 颜色 token |
|---|---|---|
| accepted | ● 实心圆 | `bg-primary` |
| draft | ○ 空心环（`border`） | `border-accent` + `bg-transparent` |
| orphan | ▲ / ■ 实心 | `bg-warning` |
| active（当前跳转目标） | 圆点放大 1.8× + 外圈光环（`ring`） | 高亮 |

- 圆点直径：静止 10px，hover / active 放大到 14–16px（`transition` 150ms ease-out）。
- **竖轴**：一条 `absolute` 2px 竖线贯穿 rail 全高，居中于圆点列；无批注时不画轴、只留折叠竖线。

### 2.2 分布策略（两态自适应）

- **少节点（≤ 可视高度 / 最小间距）**：圆点按 seq **等比例映射到 rail 全高**（`top = seqRank/(n-1) * fullHeight`），自然「铺满、间隔大」。
- **多节点（超过可用高度）**：改用 **固定间距（约 28px / 槽）+ rail 内部滚动**，保持每个圆点可独立 hover / 点击，不丢精度。
- 阈值常量化：`RailMinDotGap = 28`，运行时按 `containerHeight` 决定走哪条分支；两条分支共用同一套圆点组件与 pin 逻辑。

### 2.3 交互（沿用已上线的 pin 行为）

- 点击圆点 → 跳转 `seqToIndex(seq)` + **钉住卡片**（沿用 `74430cbb` 的 `pinnedIndex` 逻辑，不再点不到 Accept）。
- 悬浮 150ms 出卡；从圆点移到卡片走 `pl-2` 鼠标桥；关闭延迟 320ms；钉住后只有关闭按钮 / 再点圆点能收起。
- 空态：折叠竖线 + 展开时「✨ 生成时间线」入口（保持 PRD 第一条验收）。

### 2.4 折叠 / 展开

- 折叠 16px：只画竖轴细线，不画圆点（空间不够）。
- 展开 36px→**放宽到 44px**，给圆点 + 可选右侧小标签留白；偏好 `localStorage` 持久。

## 3. 弹窗不允许透明

- **悬浮卡 `AnnotationCard`**：背景强制 `bg-modalbg`（实色 `#232323`），**移除任何 `/<alpha>` 透明度修饰**，加 `shadow-2xl` 与 1px `border-border` 硬边界，确保绝不透出底层。
- **编辑器 `Modal`**：`.modal` 本体已是实色 `--modal-bg-color`；仅输入框内部 `bg-transparent` 保留（那是输入框，不是弹窗）。若需整体更实，内容区外套一层 `bg-modalbg` 无 alpha 容器。
- 全仓排查：任何 `annotat*` 相关组件不得出现 `bg-*/20`、`/30`、`backdrop-blur`、半透明边框。

## 4. 改动文件

| 文件 | 改动 |
|---|---|
| `frontend/app/view/aisessions/annotation-rail.tsx` | 横向药丸 → 竖向圆点 + 竖轴；两态分布；展开宽度 44px |
| `frontend/app/view/aisessions/annotation-model.ts` | 新增 `RailMinDotGap`、`RailDotSize` 等常量；`clusterRailItems` 保持聚类逻辑但输出可用于垂直分布的 `rank` |
| `frontend/app/view/aisessions/annotation-card.tsx` | 背景强制实色、去透明；保留 pin / close |
| `frontend/app/theme.scss` 或 `tailwindsetup.css` | （仅当需新增 token）保证 `modalbg` 实色引用无 alpha |

**不改动**：`pkg/`（存储 / RPC / 规则）、`session-outline-rail.tsx`（信息条保持原样，正是要区分开）、跳转 / 虚拟滚动逻辑。

## 5. 测试

- 新增 / 更新 `annotation-rail.dom.test.tsx`：
  - 圆点渲染（accepted/draft/orphan 三种形状 + 颜色 class）。
  - 点击圆点 → pin 卡片 → Accept 可点（沿用上一轮断言）。
  - 空态展开有生成入口。
- `npx vitest run frontend/app/view/aisessions` 全绿。
- 手动：2000+ 消息会话下 rail 不卡（FPS）、跳转准确、圆点密集时走滚动分支。

## 6. 待确认

1. **分布模式**：上述「少则铺满、多则滚动」两态自适应是否接受？还是你更想要**永远固定大间距 + 滚动**（更简单、永远一致）？
2. **展开宽度**：36px → 44px 是否够？还是想要更宽（如 56px）让圆点更舒展？
3. **右侧标签**：圆点旁是否要常显 `#seq` 小字（如 `#3 #12`），还是只在 hover 卡片里显示？
4. **弹窗范围**：「不允许透明」只指悬浮卡，还是也包括下方的编辑器 Modal 整体要做成更实？
