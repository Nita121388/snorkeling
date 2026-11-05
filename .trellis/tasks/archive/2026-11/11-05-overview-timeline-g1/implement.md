# 执行计划（G1 时间线）

1. [ ] `persisted-enum.ts`：抽 `createPersistedEnum`（含 `PersistedEnum` 类型），`overview-board-model.ts` 改导入；
       跑既有 board 单测确认零回归。
2. [ ] `overview-timeline-model.ts`：range 枚举 + atom + `buildTimelineRows` / `buildTimelineBar` /
       `buildTimelineTicks` / `formatTimelineRangeLabel`。
3. [ ] `overview-timeline-model.test.ts`：窗口裁剪 / createdAt 缺失 / live 延到 now / 倒序 /
       刻度文案（≤8h vs ≥24h）/ range 持久化回落 / 空数据。
4. [ ] `overview-timeline.tsx`：行渲染（头像 + 标题 + meta + 轨道 + 条纹 + 尾巴 + now 线 + 空态）。
5. [ ] `overview-board-model.ts`：`OverviewViewModesImplemented` 加 `"timeline"`。
6. [ ] `session-overview.tsx`：视图按钮元数据化（列表/看板/时间线），时间线模式渲染组件 + 时间窗选择器。
7. [ ] `session-overview.scss`：时间线样式（轨道网格 12 列、条纹、now 线、窄面板横滚、行 hover）。
8. [ ] `scripts/verify/overview-timeline/verify.mjs`：新 area（照 `_template` + 播种 agent 块）。
9. [ ] 验证：`npx vitest run frontend/app/session-overview/`、tsc 基线 69、
       `node scripts/verify/overview-timeline/verify.mjs`（新 area 全绿）、
       `node scripts/verify/overview-board/verify.mjs`（38/38 零回归）、截图人工过目。
10. [ ] 提交 + 归档 + 回写 spec / 开发记录 / HANDOFF / scripts/verify/README.md area 表。

## 门

- 单测/tsc 每步跑；tsc 新增 error 即停。
- 真机若「行高塌陷 / 条纹与 now 线错位 / 大量会话滚动卡」→ 先修再过门。

---

## 完成记录（2026-11-05）

- [x] 1 `persisted-enum.ts`：抽出 `createPersistedEnum`（字符串枚举）+ `createPersistedNumberEnum`（数值枚举，
      时间窗用），viewMode / boardGroup / timelineRange 三处共用；board 单测零回归
- [x] 2 `overview-timeline-model.ts`：`OverviewTimelineRanges [2,8,24,168]` + range atom +
      `buildTimelineRows` / `buildTimelineBar` / `buildTimelineTicks` / `formatTimelineRangeLabel`
- [x] 3 单测 18 条（窗口裁剪 / createdAt 缺失 / `activeSince` 兜底 / live 延到 now / 倒序 / 零宽最小可见 /
      刻度文案 8h vs 7d / range 持久化回落）→ 本目录 129 passed
- [x] 4 `overview-timeline.tsx`：行（头像 + 标题 + provider · 项目 · msgs · age）+ 轨道 + 斜纹历史段 +
      当前状态尾巴 + now 线 + 图例 + 空态
- [x] 5 `OverviewViewModesImplemented` 加 `"timeline"`；header 视图按钮改成 `OverviewViewModeMeta` 元数据驱动
      （新增视图只改 meta + 渲染分支）
- [x] 6 时间窗选择器（`[data-overview-range]`，仅时间线模式），8h 默认，持久化
- [x] 7 SCSS：轨道网格 / 斜纹 / 状态尾巴 / now 线 / **窄面板（<560px）改成「标签一行 + 轨道一行」**，
      刻度隔一个隐藏，不再靠横滚找条
- [x] 8 新验证 area `scripts/verify/overview-timeline/`（照 `_template` + 播种 agent 块）**18/18**；
      `overview-board` 38/38 零回归（顺手把「视图按钮 = 3 枚」的断言更新）

### 过程中修掉的两个真问题

1. **渲染分支插错了位置**：`viewMode === "timeline"` 的三元第一次插到 header 的分组选择器上，
   导致时间线渲染在头部、body 仍是列表（验证台 `timeline-hides-others` 报 rows=2 抓到）。
2. **零宽条看不见**：没有会话摘要的块 `startedAt === endedAt`，条宽 0 → 视觉上完全没有条。
   修法：模型给最小 0.9% 宽并夹住 left（不越过 now 线），CSS 再兜 `min-width: 8px`；
   同时 `buildTimelineRows` 在没有 `createdAt` 时优先用 `AgentStatus.activeSince` 当起点（真实已知起点），
   实在没有才退到 `updatedAt`/now，并在 tooltip 标 `start unknown`。

### 遗留

- 「更早（n）」折叠未做（设计文档 §3/§7 已记为可选）。
- G2 状态分段需要 per-block 状态历史，按设计文档单独立项。
