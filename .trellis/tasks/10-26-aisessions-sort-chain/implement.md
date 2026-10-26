# 执行计划：AI Sessions 排序链（消息数 / 子会话数 / 时间组合）

> 状态：planning。`task.py start` 后才进入 Phase 2。
> 详细设计与 ASCII 见 `design.md`；需求与验收见 `prd.md`。

## 前置

```bash
cd /Users/nita/Primary/projects/snorkeling

# 基线（前端包）
npm test -- --run aisessions

# 关键文件现状确认
sed -n '113,150p' frontend/app/view/aisessions/controls.tsx
sed -n '140,175p' frontend/app/view/aisessions/utils.ts
sed -n '245,270p' frontend/app/view/aisessions/utils.ts
sed -n '90,160p' frontend/app/view/aisessions/session-tree.ts
```

**开工前确认工作区干净**（`git status --short`），与其它任务分开提交。

## M1 模型层（纯函数，先行 + 单测）

- [ ] 1.1 `types.ts`：新增 `SessionSortField = "time" | "messages" | "subagents"`、
      `SessionSortKey = { field, desc }`、`SessionSortChain = SessionSortKey[]`、
      `DEFAULT_SORT_CHAIN`、`sortChainStorageKey`。
- [ ] 1.2 `types.ts`：`sanitizeSortChain(raw): SessionSortChain`
      （剔非法 field、按 field 去重保留首个、截断 3、空则默认）。
- [ ] 1.3 `types.ts`：`readSortChain()` / `writeSortChain(chain)`
      （读不到 → 回退老 `aisessions.sortDescending` → `DEFAULT_SORT_CHAIN`；SSR 安全）。
- [ ] 1.4 `utils.ts`：`countSubSessions(sessions): Map<string, number>`
      （按 `parentKey` 聚合，只统计非空 `parentKey`）。
- [ ] 1.5 `utils.ts`：`makeSessionComparator(chain, counts?)` 与 `sortSessions(sessions, chain)`；
      按 `design.md` §3 的链 + 隐式 `updatedAt` 降序 + `key` 升序兜底。
- [ ] 1.6 单测：`utils.test.ts` 增 `describe("sort chain")`
      - 单键 messages/subagents 升降序
      - 双键（subagents 相等 → messages）
      - 三键 + 隐式兜底
      - 全 0 值时仍按时间降序（不是原顺序）
      - `sanitizeSortChain`：非法字段 / 重复 / 超长 / 空
      - `readSortChain` 迁移：老 `sortDescending=0` → `[{time,desc:false}]`

**审查门 G1**：`npm test -- --run aisessions` 全绿；比较器行为与 `design.md` §3 一致。

## M2 树 / 分组接入 comparator

- [ ] 2.1 `session-tree.ts`：`buildSessionTree(rows, matchedKeys?, descending = true, compare?)`
      —— 第 4 参可选 comparator；内部 `makeSessionOrder` 在传入 `compare` 时直接用它。
- [ ] 2.2 `utils.ts`：`groupSessionsByProject(sessions, descending = true, compare?)`
      - 桶内 `buildSessionTree(..., descending, compare)`
      - **分组顺序改取组内 `max(updatedAt)`**（不再假设 `sessions[0]` 最新）
- [ ] 2.3 回归 `session-tree.test.ts` / `utils.test.ts`：不传 `compare` 的旧用例必须原样通过。
- [ ] 2.4 新测：传入 `Most messages` comparator 后树/组顺序正确。

**审查门 G2**：所有既有 `buildSessionTree` / `groupSessionsByProject` 调用点零改动仍通过。

## M3 UI：SortMenu

- [ ] 3.1 新文件 `sort-menu.tsx`：`floating-ui` 下拉（`useFloating` + `useDismiss`，
      参考 `frontend/app/tab/tab-more-menu.tsx` 的写法）。
      - 上半区：链内项，`①②③` 序号 + 字段名 + 方向箭头（点击翻转）+ `×`（移除）。
      - 下半区：未入选项 ⊕（满 3 条置灰 + `Max 3 keys` 提示）。
      - 底部 `Reset to default`。
- [ ] 3.2 `controls.tsx`：保留 `SortButton` 导出做兼容，或替换为 `SortMenu`；
      按钮文案按 `design.md` §4 生成（单键 `Newest` / 双键 `Time·Subs` / 三键 `Time·Msgs·Subs`）。
- [ ] 3.3 键盘：`Esc` 关闭；弹层内方向键可选（非阻塞项，可延后）。
- [ ] 3.4 DOM 测试 `sort-menu.dom.test.tsx`：
      - 点未入选项 → 追加到链且序号正确
      - 点方向箭头 → 只翻方向
      - 点 × → 移除 + 序号前移
      - 满 3 条置灰
      - `Reset` 恢复默认

**审查门 G3**：DOM 测试通过；视觉与工具栏其它控件同高（`h-7`）。

## M4 容器接线

- [ ] 4.1 `aisessions.tsx`：`sortChainAtom`（初值 `readSortChain()`），替代/并存 `sortDescendingAtom`；
      `useEffect` 写回 localStorage。
- [ ] 4.2 `visibleSessions` 改用 `sortSessions(sessions, sortChain)`；`groupedSessions` 传 `compare`。
- [ ] 4.3 工具栏 `SortButton` → `SortMenu`。
- [ ] 4.4 `GroupedSessionList` / `session-group.tsx`：`sortDescending` 改为 `sortChain`（或 `compare`）。
- [ ] 4.5 `loadSessions` 里选首个会话（`aisessions.tsx:463`）继续用 `sortSessionsByTime(sessions, true)`（时间最新）。
- [ ] 4.6 其它 `loadSessions(..., sortDescending, ...)` 调用点同步为"方向"语义（保留时间方向）。
      注意：`loadSessions` 的第二个参数当前是 `sortDescending`，只用于"首个会话"，不要误改成链。

**审查门 G4**：手动跑 UI（Time 模式 + Project 模式）确认排序、折叠分组、`New Chat` 置顶都正常。

## M5 收尾

- [ ] 5.1 `npm test`（全量前端）通过；`npm run lint` / type-check。
- [ ] 5.2 更新 `design.md` §8 待确认项为最终结论（如有变更）。
- [ ] 5.3 提交（与其它任务分开），commit message：
      `feat(aisessions): 排序链（时间/消息数/子会话数组合排序）`
- [ ] 5.4 归档任务：`python3 ./.trellis/scripts/task.py archive 10-26-aisessions-sort-chain`

## 回滚点

- M1 全在纯函数层，回滚只需删新增导出，不影响现有行为。
- M2 用可选参数，回滚 = 调用方停止传 `compare`。
- M3/M4 是 UI 层，回滚 = 恢复 `SortButton` + `sortDescendingAtom`。

## 风险

| 风险 | 处理 |
|---|---|
| `sortDescending` 仍被 `loadSessions` 用于选首个会话 | 明确保留为"时间方向"，不与链耦合 |
| 分组顺序依赖 `sessions[0]` 最新 | M2 改为 `max(updatedAt)` |
| 子会话计数随筛选变化 | PRD 已写明口径与限制，与行徽标一致 |
| 现有 `buildSessionTree` 测试 | 新参数可选，旧用例零改动 |
