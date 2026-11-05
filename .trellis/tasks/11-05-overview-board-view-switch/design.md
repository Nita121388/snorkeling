# 技术设计（C：视图切换 + 看板分组）

## 1. 数据模型（`overview-board-model.ts`）

```ts
/** 视图模式：timeline 由 D 接入；当前"已实现"集合只有前两个。 */
export type OverviewViewMode = "list" | "board" | "timeline";
export const OverviewViewModesImplemented = ["list", "board"] as const;

export type OverviewBoardGroup = "status" | "tab" | "provider";
export const OverviewBoardGroups = ["status", "tab", "provider"] as const;

/** 渲染层统一列模型：tone 只有 status 分组有值（决定列头色点）。 */
export type OverviewBoardColumnModel<T> = {
    key: string;              // "status:working" / "tab:<tabId>" / "provider:Claude"
    title: string;
    tone?: OverviewBoardStatus;
    blocks: T[];
};
```

分组函数（全部纯函数）：
- `groupOverviewCardsByStatus(cards, presentedStatuses, { includeEmpty })` — 包一层现有 `groupBlocksByStatus`
- `groupOverviewCardsByTab(cards)` — 首次出现顺序 = Tab 顺序（cards 本身来自 `displayedTabGroups`，顺序即 workspace 顺序）
- `groupOverviewCardsByProvider(cards)` — 按 `providerDisplayLabel` 分组，空 →「非 Agent」；排序：卡片数降序 → 标题升序
- `groupOverviewCards(cards, presentedStatuses, group, opts)` — 分发到上面三支

## 2. 状态与持久化

| atom | key | 值域 | 默认 |
|---|---|---|---|
| `overviewViewModeAtom`（已有，改 validator） | `snorkeling.overview.viewMode` | list / board | list |
| `overviewBoardGroupAtom`（新增） | `snorkeling.overview.boardGroup` | status / tab / provider | status |

沿用 `atomWithStorage` + 自定义 `SyncStorage`（与 `overviewViewModeAtom` 同一套 `read/write/subscribe` 写法：
读写 try/catch、`storage` 事件跨窗口同步、非法值回落默认）。

## 3. UI

```
header actions: [≡ 列表][▦ 看板]  [分组 ▾]  [Opened Tabs][Agents]  [Messages n]
```

- 分段切换器：`.session-overview-view-switch` + `.session-overview-view-switch-button`，
  按钮带 `data-overview-view` 与 `aria-pressed`；沿用现有 `session-overview-icon-button` 的尺寸/悬停变量。
- 分组下拉：原生 `<select class="session-overview-group-select" data-overview-group>`（可键盘操作、CDP 可直接设值），
  选项文案 `状态 / Tab / Provider`；仅看板模式渲染。
- 状态分组时 `includeEmpty: true`（5 列常显）；tab/provider 分组不传 `includeEmpty`（不显示空列）。
- `OverviewBoard` props 从 `includeEmpty?: boolean` 改为 `group: OverviewBoardGroup`（内部决定 includeEmpty 与分组函数）。

## 4. 兼容 / 回滚

- `OVERVIEW_BOARD_ENABLED=false` 仍回纯列表。
- 旧用户 localStorage 只有 `viewMode`：分组默认 `status`，行为等于现状。
- 若未来 `timeline` 被写进 storage 而当前版本未实现 → validator 拒绝 → 回落 `list`（不白屏）。

## 5. 验证设计

- 单测（`overview-board.test.ts`）：tab 分组顺序 / provider 排序与兜底 / 分组分配器 / 分组 atom 读写回落
- 真机（`scripts/verify/overview-board/verify.mjs`）：
  - `view-switch-segmented`：两枚按钮存在且 `aria-pressed` 与当前模式一致
  - `group-select-present`：看板模式下存在 `[data-overview-group]`
  - `group-tab-columns`：选 tab → 列头 = Tab 名，无空列
  - `group-provider-columns`：选 provider → 列头含 `Claude`（播种的 agent 块）
  - `group-persist`：选择写进 localStorage 且 reload 后保持
  - 既有 status 分组 5 列 / snap / 卡片架构断言全部保留

## 6. 风险

| 风险 | 处置 |
|---|---|
| 分段切换器替换旧 toggle → 既有验证脚本选择器失效 | 脚本同步改成 `[data-overview-view]`，并保留 `.session-overview-view-toggle` 到「看板」按钮上做兼容 |
| tab 分组下列太多（每个 Tab 一列） | 列宽固定 220px + 横向 snap，天然可滑；不额外做折叠 |
| provider 分组下没有 provider 的 term 块全挤一列 | 归「非 Agent」，文案明确 |
