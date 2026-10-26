# 执行计划：Tab「更多」下拉悬浮展示 Agent Card

> 状态：planning。`task.py start` 后才进入 Phase 2。
> 详细设计与 ASCII 见 `design.md`；需求与验收见 `prd.md`。

## 前置

```bash
cd /Users/nita/Primary/projects/snorkeling

# 现状基线
cat frontend/app/tab/tab-more-menu.tsx
cat frontend/app/block/block.tsx | sed -n '180,200p;450,590p'
cat frontend/app/view/term/agent-hover-card.tsx | sed -n '1,60p'
git status --short
```

**开工前确认工作区干净**（`git status --short`），与「父级归位」「OpenCode 扫描」等任务分开提交。

## M1 model 层（纯函数 + 单测）

- [ ] 1.1 `tab-more-model.ts`：`TabMoreMeta` 增加 `blockIds: string[]`。
      `getTabMoreMetaAtom` 里把每个 tab 的 `tab.blockids` + 各 block 的 `subblockids`
      一并收集（缺失 meta 的 tab 跳过；block 无 `subblockids` 不报错）。
- [ ] 1.2 `tab-more-model.ts`：新增 `AgentBlockRef = { blockId; updatedAt }`、
      `collectTabAgentBlocks(meta, getBlock): AgentBlockRef[]`
      —— 过滤 `isAgentTerminalMeta(block.meta)`，按 `updatedAt` 降序。
      纯函数，测试直接给 meta + 假的 `getBlock`。
- [ ] 1.3 单测：`tab-more-model.test.ts` 增 `describe("collectTabAgentBlocks")`
      - 空 blockIds → `[]`
      - 过滤掉 note / preview / session-detail block（只留 agent）
      - 多 agent 按 `updatedAt` 降序
      - `subblockids` 里的 inline agent block 也被纳入

**审查门 G1**：单测全绿；`getTabMoreMetaAtom` 不破坏既有 `TabMoreMenu` 渲染。

## M2 UI：TabMoreAgentCard

- [ ] 2.1 新文件 `tab-more-agent-card.tsx`：
      - `TabMoreAgentCard({ blocks })`：
        `blocks.length === 0` → `null`；
        `1` → `<AgentHoverCard blockId mode="gui" />`；
        `>=2` → 标题 `N agents in this tab` + 首块完整卡 + 其余 `<AgentMiniRow />`
      - `AgentMiniRow({ blockId })`：紧凑单行
        `logo + provider·model + 状态点(复用 TabAgentStatusDot) + 短 session id + 复制`
        （无 note/tags，避免卡过高）
- [ ] 2.2 `TabMoreRowItem`（`tab-more-menu.tsx`）改造：
      - 每行 `useInfoCardHover({ placement: "right", targetRef })`
      - 行 `targetProps` 接上；`cardContent = TabMoreAgentCard({ blocks })`
      - `blocks.length > 0` 时渲染 `<InfoCardPortal hover={cardHover}>{cardContent}</InfoCardPortal>`
      - `useInfoCardHover` 每行独立实例化，全局独占管理器保证同一时刻只有一张卡

**审查门 G2**：DOM 测试通过前先手工目视：垂直栏 + 水平栏都试一次。

## M3 测试

- [ ] 3.1 DOM 测试 `tab-more-menu.dom.test.tsx` 增用例：
      - hover 含 1 个 agent 的行 → portal 出现完整 `AgentHoverCard`（断言 provider / session id 文本）
      - hover 含 ≥2 个 agent 的行 → portal 出现 `N agents in this tab` + 首块完整 + 次块 `AgentMiniRow`
      - hover 0 个 agent 的行 → 无 portal（原生 title 仍在）
      - 移出 300ms → 卡片消失

**审查门 G3**：`npm test -- --run tab` 全绿。

## M4 收尾

- [ ] 4.1 `npm test`（全量前端）通过；`npm run lint` / type-check。
- [ ] 4.2 更新 `design.md` §待确认为最终结论（如变更）。
- [ ] 4.3 提交（与其它任务分开），commit message：
      `feat(tab): 更多下拉 hover 展示 Agent Card`
- [ ] 4.4 归档任务：`python3 ./.trellis/scripts/task.py archive 10-26-tab-more-agent-card`

## 回滚点

- M1 纯函数层，回滚 = 删除 `blockIds` 与 `collectTabAgentBlocks` 导出。
- M2 是 UI 层，回滚 = `TabMoreRowItem` 移除 hover/portal 接入。

## 风险

| 风险 | 处理 |
|---|---|
| `useInfoCardHover` 在每行多实例是否冲突 | 全局独占管理器（claimInfoCard）保证同时只开一张卡 |
| agent block 状态订阅开销 | 仅 hover 渲染卡片时才订阅，不 hover 不订阅 |
| 贴边浮层溢出 | `useInfoCardHover` 按 placement 算坐标；必要时改 `left` |
| 行点击 vs 卡片焦点 | `InfoCardPortal` + `useInfoCardDismiss` 已处理点外侧关闭 + 先 blur |
