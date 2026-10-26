# 技术设计：AI Sessions 排序链（消息数 / 子会话数 / 时间组合）

## 1. 现状（代码坐标）

| 位置 | 现状 |
|---|---|
| `frontend/app/view/aisessions/aisessions.tsx:131` | `sortDescendingAtom = jotai.atom<boolean>(readSortPreference())` —— 只有"方向" |
| `frontend/app/view/aisessions/aisessions.tsx:1351,1381` | `visibleSessions = sortSessionsByTime(...)`、`groupedSessions = groupSessionsByProject(..., sortDescending)` |
| `frontend/app/view/aisessions/utils.ts:148` | `sortSessionsByTime(sessions, descending)` —— 唯一比较器 |
| `frontend/app/view/aisessions/utils.ts:251` | `groupSessionsByProject(sessions, descending)` —— 桶内 `buildSessionTree`，分组顺序取 `sessions[0]` 时间 |
| `frontend/app/view/aisessions/utils.ts:252` | `sessionSortTime(s) = s.updatedAt || s.createdAt` |
| `frontend/app/view/aisessions/session-tree.ts:95` | `buildSessionTree(rows, matchedKeys?, descending = true)` —— 排序硬绑定 descending |
| `frontend/app/view/aisessions/controls.tsx:113` | `SortButton({ descending, onToggle })` —— 纯方向切换按钮 |
| `frontend/app/view/aisessions/session-row.tsx:522` | 行内 `session.messageCount ?? 0 msgs` 已展示 |
| `frontend/app/view/aisessions/session-row.tsx:194` | `+N 子会话` 徽标由 `childCount` 现算（`buildSessionTree` 产出） |
| `frontend/types/gotypes.d.ts:2574` | `SessionSummary.messageCount?: number` 已有 |
| `pkg/aisessions/types.go:39` | 后端 `MessageCount int`（已输出），无 `subagentCount`（子会话数前端按 `parentKey` 现算） |

## 2. 数据口径

| 排序字段 | 取数 | 口径说明 |
|---|---|---|
| `time` | `updatedAt || createdAt` | 现状 |
| `messages` | `messageCount ?? 0` | 缺失按 0；稳定排序兜底用 key |
| `subagents` | `parentKey === 本会话 key 的行数`（含 `kind=subagent` + `kind=fork`） | 与行内 `+N` 徽标同口径 |

> 限制：子会话数是**在当前可见结果集**上统计的（搜索/筛选会把子会话滤掉，计数随结果集变化）。
> 行内 `+N` 徽标本来就走同一套口径，所以自洽。
> 若以后要绝对真值，再加后端 `subagentCount` 字段（本次 MVP 不做）。

## 3. 排序链模型

```ts
type SessionSortField = "time" | "messages" | "subagents";
type SessionSortKey = { field: SessionSortField; desc: boolean };
type SessionSortChain = SessionSortKey[];  // 长度 1..3，前者优先级高

const DEFAULT_SORT_CHAIN: SessionSortChain = [{ field: "time", desc: true }];
```

### 比较规则
```
compare(a, b):
  for each key in chain:
    c = compareByField(a, b, key.field) * (key.desc ? -1 : 1)
    if c !== 0: return c
  // 隐式兜底（避免大量 0 值 / 相同时"没排序一样"）
  c = (b.updatedAt||b.createdAt) - (a.updatedAt||a.createdAt)   // 时间降序
  if c !== 0: return c
  return a.key.localeCompare(b.key)                              // 最终稳定
```

### 持久化与迁移
- `aisessions.sortChain`（新），读不到时回退老 `aisessions.sortDescending`（= `[{time,desc}]`），再回退 `DEFAULT_SORT_CHAIN`。
- 写：`writeSortChain(chain)`；`readSortChain()` 走 `sanitizeSortChain`（去重、截断 3、剔非法字段、空则默认）。

## 4. 控件形态（ASCII）

```
 工具栏（现状）：[🔍 Search]  (📁 Project | 🕒 Time)  …  [Filters] [↕ Newest ▾] [⇊ 12] [🏷]
                                          │
                                          ▼ 点击 [↕ Newest ▾]

 默认态（等价现状）：
 ┌──────────────────────────────────┐
 │ SORT BY                  1 / 3    │
 ├──────────────────────────────────┤
 │ ① Newest first             ↓  ×   │
 │ ──────────────────────────────── │
 │ ⊕ Oldest first                   │
 │ ⊕ Most messages                  │
 │ ⊕ Fewest messages                │
 │ ⊕ Most sub-sessions              │
 │ ⊕ Fewest sub-sessions            │
 ├──────────────────────────────────┤
 │ Reset to default                 │
 └──────────────────────────────────┘

 点「Most sub-sessions」后（追加为 ②）：
 ┌──────────────────────────────────┐
 │ SORT BY                  2 / 3    │
 ├──────────────────────────────────┤
 │ ① Newest first             ↓  ×   │
 │ ② Most sub-sessions        ↓  ×   │
 │ ──────────────────────────────── │
 │ ⊕ Most messages                  │
 │ ⊕ Fewest messages                │
 │ ⊕ Fewest sub-sessions            │
 ├──────────────────────────────────┤
 │ Reset to default                 │
 └──────────────────────────────────┘

 各操作语义：
 ┌ 点 ① 的 ↓ ──▶ 翻转成 ↑（位置不变）
 ├ 点 ×     ──▶ 从链删除，后续序号前移
 ├ 点 ⊕ 行  ──▶ 追加到链尾；满 3 条时 ⊕ 行置灰 + 提示 "Max 3 keys"
 └ 点 Reset ──▶ 回到只有 ① Newest first
```

### 按钮文案
- 单键：`Newest` / `Oldest` / `120 msgs`（太长缩 `Msgs`）/ `3 subs`（太长缩 `Subs`）。
- 双键：`Time·Subs` / `Msgs·Subs`。
- 三键：`Time·Msgs·Subs`。
- 方向图标：`desc` = `fa-arrow-down-wide-short`，`asc` = `fa-arrow-up-short-wide`。

## 5. 列表内表现（排序只改顺序，不加新列）

```
 ▾ my-project                                  (📁 4 个会话)
   ● 018f…  codex    30m ago       120 msgs   +3 sub-sessions
     └ 🌟 sub 0190…             5m ago        12 msgs
   ● 0191…  claude   2h ago        48 msgs    +1 sub-session
   ● 0192…  pi       1d ago         6 msgs
```
- `New Chat` 占位钉在最上方（现状保留，不参与排序）。
- Time 模式：整表按链排序。
- **Project 模式（本方案决定）：分组顺序仍按"最近活跃项目"排，只有组内会话按链排序。**
  理由：否则文件夹会随消息数/子会话数大幅乱跳，破坏"项目归位"的心智。
  `groupSessionsByProject` 的分组排序改为取组内 `max(updatedAt)`（现在假设 `sessions[0]` 是最新，组内改序后会错）。

## 6. 实现落点

### 类型（`types.ts`）
- `SessionSortField` / `SessionSortKey` / `SessionSortChain` / `DEFAULT_SORT_CHAIN`。
- `sortChainStorageKey`、`readSortChain`、`writeSortChain`、`sanitizeSortChain`。

### 比较器（`utils.ts`）
- `makeSessionComparator(chain: SessionSortChain): (a, b) => number`。
- `sortSessions(sessions, chain): SessionSummary[]`（纯函数，包裹 `[...].sort`）。
- `countSubSessions(sessions): Map<string, number>`（按 `parentKey` 聚合）。
- `sortSessionsByTime` 保留（给"选中首个会话"用，见 `aisessions.tsx:463`）。

### 树 / 分组（`session-tree.ts` / `utils.ts`）
- `buildSessionTree(rows, matchedKeys?, descending = true, compare?)` —— 末尾可选 comparator；不传保持现状（旧测试零改动）。
- `groupSessionsByProject(sessions, descending = true, compare?)` —— 分组顺序改取组内 `max(updatedAt)`；桶内 tree 用 `compare`。

### UI（`controls.tsx`）
- `SortButton` → `SortMenu`：排序链面板（见 §4），`floating-ui` 定位（与 `TabMoreMenu` 同库）。
- 选中态打勾；`Esc` / 点外侧关闭。

### 容器（`aisessions.tsx`）
- 新增 `sortChainAtom`。`visibleSessions` / `groupedSessions` 改用 `sortChain`。`loadSessions` 入参的"首个会话"仍按 `sortSessionsByTime` 取时间最新。

### 测试
- `utils.test.ts`：链式比较、同值兜底、`sanitizeSortChain`（重复/超长/非法/空）、`countSubSessions`、迁移（无 `sortChain` → 默认 time desc）。
- `session-tree.test.ts`：传 comparator 时树跟随排序（现有不传用例不变）。
- 新增 DOM 测试：选择 `Most messages` → 列表重排（断言首项 msgs ≥ 末项）；`Reset` 恢复；刷新后 localStorage 持久化生效。

## 7. 影响文件

- `frontend/app/view/aisessions/types.ts`
- `frontend/app/view/aisessions/utils.ts`
- `frontend/app/view/aisessions/session-tree.ts`
- `frontend/app/view/aisessions/controls.tsx`
- `frontend/app/view/aisessions/session-group.tsx`
- `frontend/app/view/aisessions/aisessions.tsx`
- `frontend/app/view/aisessions/utils.test.ts`
- `frontend/app/view/aisessions/session-tree.test.ts`
- 新增 `frontend/app/view/aisessions/sort-menu.tsx` + `sort-menu.dom.test.tsx`

## 8. 待确认

1. 排序链形态：**方案 C（最多 3 键链）**（本方案采用）／方案 B（主 + 次两键）。
2. Project 分组模式分组顺序：**不参与排序，仍按最近活跃项目**（本方案采用）／分组也按链排序。
3. 子会话计数口径：**subagent + fork 都算**（与行内 `+N` 一致，本方案采用）／只算 `kind=subagent`。

---

## 9. 实现备注（2026-10-27，落地后回填）

与 §4 的偏差与额外决定：

1. **Add 区每种字段一个入口（不再是 6 个方向选项）**
   点「⊕ Most messages」= 以 `desc: true` 追加；方向在链内点箭头翻转。
   少了 3 行噪音，且避免「先点 Most 再点 Fewest」这种互相抵消的操作。
2. **链满 3 条时 Add 区整段隐藏**（三个字段都在链里，没有可加项），而不是渲染 3 行 disabled。
3. **`SortButton` 从 `controls.tsx` 删除** —— 改造后无引用；时间方向语义并入排序链。
4. **分组顺序取 `max(updatedAt)`**
   §5 的「Project 模式分组顺序仍按最近活跃项目」在实现时发现原代码假设
   `sessions[0]` 最新；组内改序后这个假设失效，改为组内 `max(updatedAt)`。
5. **`countSubSessions` 只统计父在结果集内的行**
   父被筛掉时该行按孤儿处理（与 `buildSessionTree` 把孤儿提升为顶层的口径一致），
   避免出现「指向不存在父」的计数键。
6. **测试环境**
   Node 26 的 jsdom 不再默认提供 `localStorage`，本任务新增/受影响测试统一用
   `NODE_OPTIONS="--localstorage-file=/tmp/nodelocalstorage.json"` 跑（既有环境问题）。

### 验证结果
- `npx vitest run frontend/app/view/aisessions/` → 32 files / 369 tests 全绿
- `npx vitest run frontend/app/tab/` → 48 tests 全绿
- `npx tsc --noEmit` → 本次改动相关文件无错误
