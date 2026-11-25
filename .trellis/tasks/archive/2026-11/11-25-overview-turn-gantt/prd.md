# Overview 时间线按对话轮拆分甘特原型（turn gantt）

## Goal

Overview 时间线/甘特图按会话内**对话轮（turn）**拆分，替换现有"整会话两段式"粗粒度条：

```
[空闲 18m]│≈思考 12s│工具 0.5s│≈思考 9s│工具 0.4s│…│生成回复 24s│▲完成 │空闲 2h10m│…
```

本轮交付：**交互原型 + 设计文档 G3 章节**。后端批量 RPC 与正式实现留下一包。

## Requirements

### R1 段模型（四类段 + 完成点）

| 段 | 数据来源 | 精度 |
|---|---|---|
| `idle` 空闲 | 上一轮末条消息 → 下一轮首条（用户提问） | 精确 |
| `think` 思考（估） | 上一条消息（提问/工具结果）→ 下一条**含工具调用**的 assistant 条目 | **估算**（含网络/API 延迟与正文生成；tooltip 必须标"估算"） |
| `tool` 工具执行 | assistant 条目 → role=tool 结果条目 | 精确 |
| `reply` 回复生成 | 最后一个工具结果 → 末条纯文本 assistant 条目 | 与 think 同族（含思考） |
| `▲` 完成点 | 每轮最后一条消息时间戳 | 精确 |

数据事实（2026-11-25 真机验证，真实 snorkeling 会话 192 条消息）：
- assistant 条目时间戳 = **生成完成/工具发起时刻**（assistant→toolResult 中位 0.5s 证明）
- toolResult → assistant+toolCall 中位 9.5~12.4s = 思考+决策
- user → assistant 中位 10.9s；assistant → user 中位 135.5s（空闲）

### R2 性能硬约束（原型必须演示这些机制，不是只画图）

- 段聚合放**后端一次 SQL 扫描**（读索引时归并窗口内消息为 `[{kind, fromMs, toMs}]`），RPC 只传纯数字
- 每行降采样封顶 ~60 段（相邻不足最小可见宽的段合并）
- 渐进渲染：首帧粗条（现状 G2.1），turn 数据到达后原地换段，DOM 结构不变
- 无索引/stale 会话降级为现状渲染，永不阻塞首屏

### R3 视觉

- 条外框圆角 **4px**（多段拼接时段为条内铺排矩形，不各自圆角）
- 段配色与现有 `--agent-*` token 同族（working/blocked/idle…）
- hover tooltip：每段时长 + 类型 + 估算标记；轮完成点 `HH:MM 完成`
- 思考段加细斜纹标记"估算"

## Acceptance Criteria

- [ ] 原型 `design/prototypes/overview-dashboard/overview-board-v2/turn-gantt.html` 浏览器可开，含多会话样例行
- [ ] 四类段 + 完成点 + 空闲全部可见，hover 显示时长与估算标记
- [ ] 段合并/降采样机制在原型中有演示（密集小段不爆 DOM）
- [ ] `design/plans/overview-board-timeline.md` 追加 G3 章节（段模型、数据公式、误差成分、性能设计、后端接口草案）
- [ ] 不改 `frontend/` 生产代码（本轮零代码影响）

## Out of Scope（下一包）

- 后端批量 turn-span RPC（一次 GROUP BY，批 ≤20 会话，纯数字）
- 前端正式接线（OverviewTimeline 换段渲染 + session-cache 缓存）
- verify area 扩展（overview-timeline 增加断言）
