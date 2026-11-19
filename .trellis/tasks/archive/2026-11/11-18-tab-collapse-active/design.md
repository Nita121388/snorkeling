# 设计：收起激活 Tab（收起并切走）

## 边界与不变量

- **单一状态源不变**：收起仍是 `collapsedTabIdsAtom`（`tab-collapse-state.ts`）；
  主栏可见性仍是 `selectBarVisibleTabIds` / `isTabHiddenFromBar`。
  本包**不改** `isTabHiddenFromBar` 的优先级——因为收起执行时先切走激活态，
  「激活 > 收起」的优先级天然不再冲突。
- **顺序不变量**：`setActiveTab(target)` 必须写在 `collapseTabIds([id])` **之前**，
  否则会出现一帧"激活 Tab 被收起、但 active 仍指着它"（此时 `isTabHiddenFromBar`
  因 active 优先把它放回栏上，视觉上像"没收起"）。
- **和「更多」下拉共用状态**：从下拉里点被收起的 Tab → 激活 + 解除收起，走既有路径，
  不在本包改动范围。

## 契约

### 1) 纯函数：`pickCollapseSwitchTarget`

```ts
// frontend/app/tab/tab-more-model.ts
export function pickCollapseSwitchTarget(
    tabIds: readonly string[],                                   // 物理顺序（workspace.tabids 顺序）
    targetTabId: string,                                        // 即将被收起的 Tab
    ctx: TabMoreVisibilityContext                                // active/未阅/已收起/本次已打开
): string | null;                                               // null = 没有可切的邻居
```

规则（按序）：

1. 在 `tabIds` 中定位 `targetTabId` 的下标；找不到 → 返回 `null`。
2. 向右扫描：跳过 `targetTabId` 自身、跳过 `isTabHiddenFromBar` 为 true 的 Tab
   （即会在下拉里藏着的），命中第一个 → 返回。
3. 向右无果则向左扫描，同样规则。
4. 都没有 → `null`。

说明：`isTabHiddenFromBar` 对**非激活** Tab 生效，所以扫描时至少不会选中"当前藏在
下拉里的"Tab；有未阅点的 Tab 因未被隐藏而**可能**被选中——这与用户预期一致
（未阅是"值得看"的），但 `targetTabId` 自身若是激活 Tab，其邻居判定独立。

### 2) 菜单项契约：`TabContextMenuVisibility`

```ts
export interface TabContextMenuVisibility {
    active?: boolean;               // 该 Tab 是否当前激活（仍需要：决定要不要先切走）
    hasUnreadDot?: boolean;         // 有未阅点 → 仍置灰
    /** 收起激活 Tab 后应切到的 Tab；由调用方按物理顺序解析，null/undefined = 无可切目标。 */
    switchTargetTabId?: string | null;
}
```

`enabled` 判定：

| 情形 | enabled | sublabel |
|---|---|---|
| 有未阅点 | `false` | `collapseToMoreUnreadDisabled` |
| 激活 + `switchTargetTabId` 为空 | `false` | `collapseToMoreLastTabDisabled` |
| 其余（激活且有目标 / 非激活） | `true` | 无 |

`click`：

```ts
click: () => {
    if (visibility?.active === true) {
        const target = visibility?.switchTargetTabId;
        if (target != null && target !== "") {
            env.electron.setActiveTab(target);   // 先切走
        }
    }
    collapseTabIds([id]);                        // 再收起
    recordTEvent("action:collapsetab");
}
```

`env` 依赖：`TabEnv.electron` 需新增 `setActiveTab`
（`VTabBarEnv` 已含，无需改）。

### 3) 调用点如何解析目标

两个 call site 都已经持有 `visibilityCtx`（`TabMoreVisibilityContext`）与物理顺序：

- `frontend/app/tab/tabbar.tsx`（水平栏）：`tabIds` 是物理顺序，`visibilityCtx` 已有；
  在渲染 `TabComponent` 时下传 `collapseSwitchTarget`，仅对激活 Tab 计算。
- `frontend/app/tab/vtabbar.tsx`（垂直栏）：`orderedTabIds` + `visibilityCtx`；
  `VTabBar` 计算，`VTabWrapper` 作为 prop 接收并传给 `buildTabContextMenu`。

下传用**已解析结果**（`string | null`）而不是整份 ctx，保持 `tabcontextmenu.ts`
不依赖 atom / DOM（可单测，与现有测试风格一致）。

### 4) i18n

| key | en | zh |
|---|---|---|
| `tab:contextMenu.collapseToMoreLastTabDisabled` | `At least one tab must stay open` | `至少保留一个 Tab` |
| `tab:contextMenu.collapseToMoreActiveDisabled` | **删除**（不再有该语义） | **删除** |

## 兼容性 / 回滚

- `visibility` 的两个新字段都是可选的：旧调用点（未传）保持可点，行为等价于
  "非激活 Tab 收起"——与 N-1117 的向后兼容契约一致。
- 回滚 = 回退本包 commit；`collapsedTabIdsAtom` 状态与下拉共用，无数据迁移。

## 测试策略（红证在实现前采集）

| 用例 | 断言 |
|---|---|
| 激活 Tab + 有右邻 | `enabled === true`；click 后 `setActiveTab` 收到右邻、`collapseTabIds(["t1"])`、埋点一次 |
| 激活 Tab + 无目标（仅剩一个） | `enabled === false`，sublabel = `collapseToMoreLastTabDisabled` |
| 激活 Tab + 有未阅点 | `enabled === false`，sublabel = `collapseToMoreUnreadDisabled`（未阅优先于激活） |
| 非激活 Tab | 可点；click 只收不切（`setActiveTab` 不被调用） |
| 无 visibility | 可点（向后兼容） |
| `pickCollapseSwitchTarget` | 右邻优先 / 右邻隐藏取左邻 / 两侧全隐藏返回 null / 目标不在列表返回 null |
