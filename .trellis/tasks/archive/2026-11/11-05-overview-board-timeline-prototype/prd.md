# Overview 看板 D：甘特图原型（G1 / G2）

> 用户 2026-11-05：「然后再出 D 的甘特图原型」。**本轮只出原型与设计文档，不写实现。**

## Goal

给「时间线（甘特）」这第三种视图一个可点开对比的原型，并明确数据可行性，避免先实现再发现画不出来。

## Requirements

- R1 原型放 `design/prototypes/overview-board-v2/timeline-gantt.html`：纯静态、可直接浏览器打开。
- R2 必须能一键对比两版：
  - **G1 会话寿命条**（`SessionSummary.createdAt → updatedAt/now`，尾巴当前状态色，历史段 unknown 斜纹）
  - **G2 状态分段**（按状态切段，需 per-block 状态历史）
- R3 带 2h / 8h / 24h / 7d 时间窗切换（刻度文案随窗变化）、hover tooltip、按最后活动倒序。
- R4 设计文档 `design/plans/overview-board-timeline.md`：数据来源与缺口、G2 的环形历史契约
  （cap 200/块、1MB 上限 + LRU）、segments 纯函数签名、组件落点、验证设计、风险。
- R5 给出推荐路径（先 G1，真实用一周后再决定 G2）与「G2 落地时组件结构不变」的论证。

## Acceptance Criteria

- [ ] 原型能打开、两个模式与四档时间窗都能切、条长/颜色语义与设计文档一致
- [ ] 设计文档写清 G1 与 G2 的数据差异、G2 的存储契约与成本、验证断言清单
- [ ] 明确与已完成批次（A/B/C）的接口：header 分段切换器加第三枚按钮即可，不需要迁移 storage

## 非目标

- 不写 `overview-timeline.tsx`、不加 `overviewTimelineRangeAtom`、不新增验证 area（都在实现任务里）。
