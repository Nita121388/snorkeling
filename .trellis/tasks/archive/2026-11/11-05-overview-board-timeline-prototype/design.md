# 设计（D：甘特原型）

完整设计见仓库 `design/plans/overview-board-timeline.md`（成熟设计文档放 `design/plans/`，
交互原型放 `design/prototypes/`，符合 `design/DESIGN-GOVERNANCE.md` 的路由规则）。

## 本任务只产出

| 产物 | 路径 |
|---|---|
| 交互原型（G1/G2 + 2h/8h/24h/7d） | `design/prototypes/overview-board-v2/timeline-gantt.html` |
| 原型目录说明 | `design/prototypes/overview-board-v2/README.md` |
| 成熟设计文档 | `design/plans/overview-board-timeline.md` |

## 关键结论（供实现任务直接引用）

- G1 零埋点可做；G2 缺 per-block 状态历史（唯一阻塞点）。
- 两版共用同一份 `segments` 模型：G1 = 单段 unknown + 当前状态尾巴 → G2 落地时组件结构不变。
- 与 C 的接口：`OverviewViewModesImplemented` 加 `"timeline"` + header 第三枚按钮，storage 无需迁移。
