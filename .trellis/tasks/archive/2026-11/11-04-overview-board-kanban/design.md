# Design — Overview 看板（keeps 列表视图不回归）

## 产品决策（自主决断，已记录假设）

原 PRD 只有一句「从列表式改为更像看板」。基于现状数据（SessionOverview 已按 Tab 分组、每行是一个 block=会话、
已有 agent 状态 `blocked|working|done|idle|stale`）判定：

**看板 = 按 agent 状态分列的卡片墙**，而不是「按 Tab 分列」（那只是换皮的分组列表）。

- 列（固定顺序，空列默认隐藏，可在设置里显示空列）：
  `blocked`「待我处理」 / `working`「进行中」 / `done`「已完成」 / `idle`「空闲」 / `stale`「陈旧」
- 卡片：会话名（复用现有标题逻辑）+ note/最后消息预览 + 状态点 + 最近活跃时间 + 点击打开详情
- 列头：中文名 + 计数徽标（`role="status"`），空列不渲染

**视图切换**：面板头部新增 icon-only 切换按钮（列表 / 看板），状态持久化到 localStorage
（与 `preview-text-modes-store.ts` 同模式，不动 settings schema）。**默认仍是列表**——不改变现有用户行为。

## 不改的东西（硬约束）

1. 列表视图的所有行为、class、filter/sort/limit/hideUnopenedTabs/agentsOnly 语义不变
2. 不新增 RPC、不改后端、不改 settings schema
3. 不改 `useOverviewBlocks` / 状态订阅逻辑，只消费其输出
4. 单文件开关 `OVERVIEW_BOARD_ENABLED`，置 false 即回到纯列表（回滚）

## 数据流

```
useOverviewBlocks(workspace) → blocks[]（现有）
    ├─ 列表视图：现有 SessionOverviewPanel 渲染路径（不动）
    └─ 看板视图：groupBlocksByStatus(blocks, presentedStatuses, filters) → columns[]
                     reuse 现有 filter（agentsOnly / hideUnopenedTabs / displayLimit 的语义按"总数上限"应用）
```

## 卡片信息层级（Linear/Jira 式，密度优先）

```
┌────────────────────────────────┐
│ ● 会话标题            3m ago   │  ← 状态点色 = 状态；标题 ellipsis
│ note 或最后一条消息预览（1 行）   │  ← 现有 messagePreview
│ [provider] [tab 名] [badge?]   │  ← 次要信息，最多 3 个 chip
└────────────────────────────────┘
```

- 卡片高度自适应最少约 76px；列内可滚动，列高撑满面板
- 状态点颜色沿用现有 `--success/warning/error/secondary` 变量（与列表徽章一致，不引入新色板）

## 无障碍与交互

- 卡片为 `<button>`（键盘可达），title 提供完整信息
- 列头 `<h3>` + `aria-label="待我处理，3 个会话"`
- 切换按钮有 `aria-pressed` 与 title
- 看板视图保留现有键盘焦点顺序（DOM 顺序 = 列顺序 → 卡顺序）

## 响应式

- `≥720px`：多列横向（grid auto-fit，min 220px）
- `<720px`：单列纵向堆叠（每列一节），避免横向挤压

## 验证

- 单测：`groupBlocksByStatus`（纯函数）——空状态、未知状态兜底到 idle、filter 组合、上限
- 真机 CDP：切换到看板 → 断言列数/卡片数/切换持久化 → 切回列表 → 断言列表行数一致（不回归）
- 截图留证（看板 + 列表各一张）
