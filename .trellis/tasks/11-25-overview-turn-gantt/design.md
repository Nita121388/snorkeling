# Turn Gantt 技术设计（G3）

> 上游：`design/plans/overview-board-timeline.md`（G1/G2/G2.1）。本任务 = G3：会话内按对话轮拆分。

## 1. 段计算公式（唯一事实源）

输入：`ai_session_messages` 里窗口内消息行（seq, role, timestamp, tool_name, thinking 非空）。

```
轮边界   = role=user 行（每轮以用户提问开始）
think 段 = t(next assistant 行) − t(prev 行)          // prev ∈ {user, toolResult}
tool 段 = t(toolResult 行) − t(assistant 含 toolName 行)
reply 段 = t(末条纯文本 assistant 行) − t(最后 toolResult 行)   // 与 think 同族
idle 段 = t(下一轮 user 行) − t(本轮末条行)
完成点  = t(本轮末条行)
```

误差成分（必须写进 UI）：think/reply 含网络+API 延迟；assistant 条目同时带 text 时无法从段里剔除正文生成时间；并行多工具只算一次（一个条目多个 toolCall 共享时间戳）。

## 2. 后端接口草案（下一包实现）

- 新增轻量批量读：一次 SQLite 扫描 + Go 内存归并，返回每会话 `[{kind: idle|think|tool|reply, fromMs, toMs}]` + `[{turn, endMs}]`（完成点）
- 约束：批 ≤20 会话；每会话封顶最近 200 轮；窗口裁剪在 SQL `WHERE timestamp >= windowStart`；降采样在 Go 侧（归并 <0.5% 窗口宽的相邻同类段，≤60 段/行）
- **不复用 `ReadTurns`**（每页 ≤10 轮、每轮 3 次 SQL、带文本，40 行会话 × N 页会爆炸）

## 3. 前端渲染（下一包实现）

- `OverviewTimelineRow` 增量加 `turnSegments?: TurnSegment[]`；有则整条替换 G2.1 两段式，无则降级现状
- 缓存走 session-cache 模式，key = `sessionId + updatedAt`；只有会话更新才重取
- 首帧粗条 → turn 数据到 → 原地换段（同 DOM 结构，无布局抖动）

## 4. 原型范围（本包）

- `design/prototypes/overview-dashboard/overview-board-v2/turn-gantt.html`：静态样例数据（含真实比例：think 中位 ~10s、tool 中位 ~0.5s、idle 中位 ~2min~2h 混合）
- 演示：段 hover tooltip、完成点、降采样合并开关（对比密集会话开/关）、圆角 4px、G2.1 降级行
