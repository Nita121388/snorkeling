# PRD：AI Sessions 排序链（消息数 / 子会话数 / 时间组合）

## 背景与问题

AI Sessions 列表当前只能按时间排（`SortButton` 是个纯方向切换，底层 `sortSessionsByTime`）。
用户想按 **消息数量**、**子会话数量** 排序，而且需要**组合排序**：

- 只按消息数排，大量会话都是 `0 msgs` → 排序后看起来"没排序一样"。
- 只按子会话数排，同样大量 `0` → 混在一起无法分辨。
- 真正想要的是「先按子会话数降序，再按消息数降序，最后按时间降序」这种多级排序。

## 目标

1. 支持**最多 3 键组合排序**：时间 / 消息数 / 子会话数，每键方向独立。
2. 链式优先级：① → ② → ③，完全相同再用隐式 `updatedAt` 降序 + `key` 升序兜底。
3. 默认只有 ① `Newest first`，等价于现状（不点就不改变行为）。
4. 偏好持久化，刷新后保持。
5. 不破坏现有：筛选、搜索、分组、父子树、批量选择、`New Chat` 置顶。

## 需求

### R1 排序链
- 可选项 6 个：`Newest first` / `Oldest first` / `Most messages` / `Fewest messages` / `Most sub-sessions` / `Fewest sub-sessions`。
- 点击未入选项 → 追加到链尾（1..3）。
- 点击已入选项的方向箭头 → 该键翻转方向，位置不变。
- 点击 × → 从链中删除，后续序号前移。
- 链满 3 条后其余 ⊕ 行置灰并提示 `Max 3 keys`。
- `Reset to default` → 回到 `[{time, desc}]`。

### R2 数据口径
| 字段 | 取数 |
|---|---|
| `time` | `updatedAt \|\| createdAt` |
| `messages` | `messageCount ?? 0` |
| `subagents` | 可见结果集中 `parentKey === key` 的行数（含 `subagent` + `fork`，与行内 `+N` 徽标同口径） |

- 子会话数在**当前可见结果集**上统计；筛选会改变计数，与行徽标一致。

### R3 控件形态
- 复用工具栏位置，把 `SortButton` 升级为 `SortMenu` 下拉（详细 ASCII 见 `design.md` §4）。
- 按钮文案反映当前链：`Newest` / `Time·Subs` / `Time·Msgs·Subs`。
- `Esc` / 点外侧关闭。

### R4 列表表现
- **Time 模式**：整表按链排序。
- **Project 模式**：**分组顺序仍按最近活跃项目**（不参与排序），只有**组内会话**按链排序。
- `New Chat` 占位永远钉在最上方。
- 子会话行跟随父行，用同一条链排序（`buildSessionTree` 接收 comparator）。
- 排序只改顺序，**不加新列**：`N msgs` 与 `+N sub-sessions` 已存在。

### R5 持久化
- `localStorage["aisessions.sortChain"]` = JSON `[{field, desc}, ...]`。
- 读不到 → 回退老 `aisessions.sortDescending` → 回退 `[{time, desc}]`。
- `sanitizeSortChain`：去非法字段、去重复字段、截断 3 条、空则默认。

## 验收标准

- [ ] 工具栏出现 `Sort` 下拉；默认显示 `Newest`。
- [ ] 依次点 `Most sub-sessions`、`Most messages` → 链变为 ①②，列表按「子会话数降 → 消息数降 → 时间降」排列。
- [ ] 点 ① 的方向箭头 → 只翻转 ① 方向，列表重排，序号不变。
- [ ] 点 × → 该项消失，后面项序号前移，列表重排。
- [ ] 选满 3 条后其余项置灰；再选不进去。
- [ ] `Reset to default` 恢复 `Newest first`。
- [ ] 刷新页面后链从 localStorage 恢复。
- [ ] Time 模式与 Project 模式都正确：Project 模式下分组顺序仍按最近活跃项目。
- [ ] `New Chat` 始终在最上方。
- [ ] 筛选 / 搜索后排序仍作用于结果集；子会话徽标与排序口径一致。
- [ ] `makeSessionComparator` / `sanitizeSortChain` / `countSubSessions` 单测通过，DOM 测试通过。

## 待确认（见 design.md §8）

1. 排序链形态：方案 C（最多 3 键，本 PRD 采用）／方案 B（主 + 次两键）。
2. Project 模式分组顺序是否参与排序（本 PRD：不参与）。
3. 子会话计数是否含 `fork`（本 PRD：含，与行内 `+N` 一致）。
