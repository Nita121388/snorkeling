# Tab 悬浮卡 agent 信息不更新：快照读改响应式 + 子块口径收口

## Goal

修复 `TabInfoCard`（App Tab 悬浮信息卡）在非激活 Tab 上 agent 信息不准确、不自动更新的问题。根因与证据见 `design/plans/tab-info-card-stale-20261120.md`。

## Requirements

- R1 **响应式数据源**：卡片展示的 tab 名 / flag 色 / block 分类计数 / agent 列表 / agent 行 provider，必须来自被订阅的 WOS atom（`getWaveObjectAtom`），`waveobj:update` 抵达后 DOM 自动刷新；禁止渲染期长驻组件用 `getObjectValue` 快照读。
- R2 **迟到数据自愈**：卡片打开时 block 对象尚未进 WOS（首读 null → 被归为 `other`）的场景，数据加载完成后卡片必须自动显示正确分类与 agent 行，无需重新 hover。
- R3 **子块口径统一**：agent 判定范围 = `tab.blockids` 顶层 + 各 block `subblockids`，与顶部 Tab 状态点（`expandBlockIdsWithSubblocks`）、「更多」菜单（`collectTabBlockIds`）同口径；三处共用一个共享纯函数，不允许第四套实现。
- R4 **不改变既有判定语义**：`classifyTabBlock` 的分类顺序、`isAgentTerminalMeta` 判定、agent-status 聚合（HIGH 影响模块）的输出保持逐字节等价；聚合只做「提取纯函数」级别的重构。
- R5 现有视觉结构（Notion 风格四段式）与 CSS 不动，纯数据层修复。

## Acceptance Criteria

- [ ] AC1 `frontend/app/tab/tab-info-card.dom.test.tsx`（由 `tmp/tab-info-card-stale.repro.test.tsx` 转正）：block meta 从 term → agent 后，卡片自动出现 agent 行；block 迟到加载后自动从 `other` 修正为 agent。
- [ ] AC2 同测试新增用例：tab 含 inline 子块（父 block `subblockids` 挂 agent 块）时，卡片 agent 行数 == 展开后 agent 块数。
- [ ] AC3 回归：`npx vitest run frontend/app/tab/ frontend/app/agent-status/` 全绿；`agent-status-tab-aggregate.test.ts` 不改断言直接通过（R4 的证明）。
- [ ] AC4 真机 hover 验证（verify 台或 CDP 手动，写入 `docs/project/verify-ledger.md` 一行）：非激活 Tab 上 hover，卡片 agent 行数/provider 与实际块数据一致，meta 变化后卡片不重开也更新。
- [ ] AC5 收尾时删除 `tmp/tab-info-card-stale.repro.test.tsx`，`design/plans/tab-info-card-stale-20261120.md` 状态更新为已落地。

## Constraints

- `frontend/app/agent-status/agent-status-tab-aggregate.ts` 是中心模块（GitNexus HIGH 影响），只提取纯函数、签名适配，不改判定顺序与输出。
- 订阅面只在 hover 打开期间存在（卡片卸载即释放），不新增常驻订阅成本。
