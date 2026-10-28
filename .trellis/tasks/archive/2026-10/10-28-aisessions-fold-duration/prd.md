# aisessions 折叠工具/子代理显示总时长

## Goal

折叠的工具组与子代理卡在头部显示总时长，便于一眼判断"这段折叠内容花了多久"。

## Requirements

- **工具组**：用组内首/尾工具锚定的消息 timestamp 差值作为总时长近似（SQLite 已持久化 timestamp）。
  - 需在 `groupConsecutiveTools` 里记录 `startSeq` / `endSeq`。
  - 单条工具不显示（未折叠）。
- **子代理卡**：`SubagentMatch.UpdatedAt - SubagentCall.Timestamp`；后端给 `SubagentCandidate` / `SubagentMatch` 补 `UpdatedAt`，折叠态即可显示，不等子会话加载。
- **可视化**：迷你时长条，宽度按「本会话最长折叠组」归一化（最小可见宽度），hover 用 `title` 显示精确时长 + 条目数。
- **格式化**：`<1s` → `850ms`；`<60s` → `3.4s`；`<60m` → `2m 3s`；否则 `1h 4m`。
- 全程 O(n) 一次计算 + useMemo，不给滚动路径增加监听或每帧 DOM 读取。

## Acceptance Criteria

- [ ] 工具折叠组头部出现时长条，hover 显示如 `Total 3.4s · 5 tools`。
- [ ] 子代理卡头部出现时长条，hover 显示如 `Total 2m 3s`。
- [ ] 无 timestamp 的消息不显示时长条（优雅降级）。
- [ ] 单条工具、加载中的子代理不显示。
- [ ] 新增 `formatDuration` 与工具组时长单测。
