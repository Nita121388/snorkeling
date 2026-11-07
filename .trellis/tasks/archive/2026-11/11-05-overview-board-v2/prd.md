# Overview 看板 v2：卡片信息架构 + 多列看板

> 用户原话：「overview 看板优化：目前看上去还是不像看板，整体还是比较列表化。也没有遵循我们原型设计的样式，
> 比如 emoji 的展示，和多种视图，目前就两种视图，甚至 agent 还显示为 Terminal。」
> 本轮范围经用户确认：**先实现 A（卡片信息架构）和 B（多列看板）**，视图切换（C）与 Gantt（D）后续单独排。

## Goal

把 SessionOverview 的「board」视图从「单列堆叠 + Terminal 标题 + 无色点」改造成真正的看板：

1. 卡片承载 agent 身份（emoji/logo 头像）与状态语义（状态词 + 读/未读），不再只有一个色点；
2. 卡片标题对 agent 块显示**会话标题**，永不出现 `Terminal`；
3. 看板常显 5 列，窄面板横向 snap 滑列而不是纵向堆叠成列表。

## 任务图（parent / child）

| 子任务 | 交付 |
|---|---|
| `11-05-overview-board-card-arch`（A） | 卡片信息架构：emoji/logo 头像、标题解析、状态 chip（抽公共组件）、provider/项目 chip、note 行 |
| `11-05-overview-board-columns`（B） | 5 列常显（includeEmpty）、横向 scroll-snap、列头状态点 + 计数、空列占位、列内滚动隔离 |

后续（不在本批，待原型签字）：`overview-board-view-switch`（分组 状态/Tab/Provider + 视图枚举迁移）、
`overview-board-timeline`（Gantt）。

## 共享约束

- **单一状态来源**：状态词/颜色/读未读只走 `agent-status` 那一套（`agentStatusPresentation` /
  `useAgentReadContext` / ack 落点 `ackAgentStatusUnified`），看板不得自建第三份映射。
- **单一身份来源**：头像只走 `getAgentIcon(provider, { meta, sessionId, personas, sessionEmojis })`
  （会话级 → provider 级 → 品牌 logo），不得新增 provider→图标映射。
- **零后端改动**：全部数据来自已有的 block meta / `SessionSummary` / `AgentStatusStore`。
- **可回滚**：`OVERVIEW_BOARD_ENABLED` 回滚开关保持有效；列表视图不受影响（行数、顺序、折叠语义不变）。
- **单写者**：A、B 触碰同一组文件（`overview-board.tsx` / `overview-board-model.ts` / `session-overview.scss`），
  **串行实现**，不并行开 worktree 写同一文件。

## Acceptance Criteria（父级）

- [ ] 看板卡片：agent 块显示 emoji 或品牌 logo（无则 robot 兜底）+ 会话标题 + 状态 chip（含读未读）+ 预览 + note（有则显示）
- [ ] 看板卡片：agent 块的标题不出现 `Terminal`
- [ ] 看板常显 5 列（blocked/working/done/idle/stale，含空列占位），列头有状态色点与计数
- [ ] 任意面板宽度下列为单行横向排列，窄宽时横向可滚动且 `scroll-snap-type` 生效，不再纵向堆叠
- [ ] 列表视图行为零回归（`scripts/verify/overview-board` 的 list 断言全绿）
- [ ] 单测：新增纯函数（标题解析/provider 文案/项目名/空列）与既有 213 行测试全绿
- [ ] 真机验证：`scripts/verify/overview-board` 扩展断言全绿，台账入库一行

## Notes

- 真机截图 `verify-runs/20261104T21234-overviewboard/02b-board-wide.png` 证据：面板内只剩「空闲」一列一张 "Terminal" 卡。
- 现状根因见 `design.md`「现状证据」一节。
